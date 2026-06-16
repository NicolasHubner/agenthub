use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use serde_json;
use parking_lot::RwLock;
use tokio::sync::{broadcast, Mutex};

use crate::protocol::{AgentSnapshot, ClientMessage, ServerMessage};

const LOG_CAP: usize = 1000;
const BROADCAST_TO: &str = "*";

/// Line injected into a canvas PTY as stdin. No ANSI codes — they corrupt readline state.
pub fn pty_message_line(from: &str, content: &str) -> String {
    format!("[{from}]: {content}\r\n")
}

pub type SharedHub = Arc<Hub>;

struct AgentEntry {
    tags: Vec<String>,
    ws_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    pty_in: Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
}

#[derive(Clone)]
pub struct Hub {
    agents: Arc<DashMap<String, AgentEntry>>,
    edges: Arc<RwLock<HashSet<(String, String)>>>,
    event_log: Arc<Mutex<VecDeque<ServerMessage>>>,
    notify: broadcast::Sender<String>,
}

impl Hub {
    pub fn new() -> Self {
        let (notify, _) = broadcast::channel(256);
        Self {
            agents: Arc::new(DashMap::new()),
            edges: Arc::new(RwLock::new(HashSet::new())),
            event_log: Arc::new(Mutex::new(VecDeque::new())),
            notify,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.notify.subscribe()
    }

    pub fn state(&self) -> ServerMessage {
        let agents = self
            .agents
            .iter()
            .map(|e| AgentSnapshot {
                name: e.key().clone(),
                connected: true,
                tags: e.value().tags.clone(),
            })
            .collect();
        let edges: Vec<[String; 2]> = self
            .edges
            .read()
            .iter()
            .map(|(a, b)| [a.clone(), b.clone()])
            .collect();
        ServerMessage::State { agents, edges }
    }

    pub async fn recent_events(&self) -> Vec<ServerMessage> {
        self.event_log.lock().await.iter().cloned().collect()
    }

    fn push_event(&self, msg: ServerMessage) {
        if let Ok(mut log) = self.event_log.try_lock() {
            if log.len() >= LOG_CAP {
                log.pop_front();
            }
            log.push_back(msg);
        }
    }

    fn broadcast(&self, msg: &ServerMessage) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.notify.send(json);
        }
    }

    fn send_json(&self, tx: &tokio::sync::mpsc::UnboundedSender<String>, msg: &ServerMessage) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = tx.send(json);
        }
    }

    fn normalize_edge(a: &str, b: &str) -> (String, String) {
        if a <= b {
            (a.to_string(), b.to_string())
        } else {
            (b.to_string(), a.to_string())
        }
    }

    fn has_edge(&self, a: &str, b: &str) -> bool {
        let edge = Self::normalize_edge(a, b);
        self.edges.read().contains(&edge)
    }

    pub fn register(
        &self,
        name: String,
        tags: Vec<String>,
        ws_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
        pty_in: Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
    ) -> Result<(), ServerMessage> {
        if self.agents.contains_key(&name) {
            self.unregister(&name);
        }
        self.agents.insert(
            name,
            AgentEntry {
                tags,
                ws_tx,
                pty_in,
            },
        );
        let state = self.state();
        self.broadcast(&state);
        Ok(())
    }

    pub fn agents_contains(&self, name: &str) -> bool {
        self.agents.contains_key(name)
    }

    pub fn unregister(&self, name: &str) {
        self.agents.remove(name);
        let mut edges = self.edges.write();
        edges.retain(|(a, b)| a != name && b != name);
        drop(edges);
        self.broadcast(&self.state());
    }

    pub fn connect(&self, a: &str, b: &str) -> Result<(), ServerMessage> {
        if a == b {
            return Err(ServerMessage::Error {
                reason: "cannot connect agent to itself".into(),
                to: None,
            });
        }
        if !self.agents.contains_key(a) || !self.agents.contains_key(b) {
            return Err(ServerMessage::Error {
                reason: "agent not connected".into(),
                to: None,
            });
        }
        self.edges
            .write()
            .insert(Self::normalize_edge(a, b));
        self.broadcast(&self.state());
        Ok(())
    }

    pub fn disconnect(&self, a: &str, b: &str) {
        self.edges
            .write()
            .remove(&Self::normalize_edge(a, b));
        self.broadcast(&self.state());
    }

    pub fn route_msg(&self, from: &str, to: &str, content: &str) -> Result<(), ServerMessage> {
        if !self.agents.contains_key(from) {
            return Err(ServerMessage::Error {
                reason: "sender not registered".into(),
                to: Some(to.into()),
            });
        }

        let broadcast = to == BROADCAST_TO;
        if !broadcast && !self.has_edge(from, to) {
            return Err(ServerMessage::Error {
                reason: "no edge between agents".into(),
                to: Some(to.into()),
            });
        }

        let delivery = ServerMessage::Msg {
            from: from.to_string(),
            to: to.to_string(),
            content: content.to_string(),
        };
        self.push_event(delivery.clone());
        self.broadcast(&delivery);

        if broadcast {
            for entry in self.agents.iter() {
                if entry.key() != from {
                    self.deliver(&entry.value(), &delivery);
                }
            }
        } else if let Some(entry) = self.agents.get(to) {
            self.deliver(&entry, &delivery);
        } else {
            return Err(ServerMessage::Error {
                reason: "agent offline".into(),
                to: Some(to.into()),
            });
        }

        Ok(())
    }

    fn deliver(&self, entry: &AgentEntry, msg: &ServerMessage) {
        if let Some(ws_tx) = &entry.ws_tx {
            self.send_json(ws_tx, msg);
        }
        if let (Some(pty_in), ServerMessage::Msg { from, content, .. }) = (&entry.pty_in, msg) {
            let line = pty_message_line(from, content);
            let _ = pty_in.send(line.into_bytes());
        }
    }

    pub async fn handle_socket(self: Arc<Self>, socket: WebSocket) {
        let (mut ws_tx, mut ws_rx) = socket.split();
        let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        let mut registered: Option<String> = None;
        let mut ui_only = false;

        let writer = tokio::spawn(async move {
            while let Some(json) = out_rx.recv().await {
                if ws_tx.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        });

        // First message decides role: subscribe (UI) or register (agent).
        if let Some(Ok(Message::Text(text))) = ws_rx.next().await {
            match serde_json::from_str::<ClientMessage>(&text) {
                Ok(ClientMessage::Subscribe) => {
                    ui_only = true;
                    let state = self.state();
                    self.send_json(&out_tx, &state);
                    for ev in self.recent_events().await {
                        self.send_json(&out_tx, &ev);
                    }
                    let mut sub = self.subscribe();
                    let out_tx = out_tx.clone();
                    tokio::spawn(async move {
                        loop {
                            match sub.recv().await {
                                Ok(json) => {
                                    if out_tx.send(json).is_err() {
                                        break;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(broadcast::error::RecvError::Closed) => break,
                            }
                        }
                    });
                }
                Ok(ClientMessage::Register { name, tags }) => {
                    if let Err(err) = self.register(name.clone(), tags, Some(out_tx.clone()), None) {
                        self.send_json(&out_tx, &err);
                        return;
                    }
                    registered = Some(name);
                }
                _ => {
                    self.send_json(
                        &out_tx,
                        &ServerMessage::Error {
                            reason: "first message must be register or subscribe".into(),
                            to: None,
                        },
                    );
                    return;
                }
            }
        } else {
            return;
        }

        while let Some(msg) = ws_rx.next().await {
            let text = match msg {
                Ok(Message::Text(t)) => t,
                Ok(Message::Close(_)) | Err(_) => break,
                _ => continue,
            };

            let parsed = match serde_json::from_str::<ClientMessage>(&text) {
                Ok(m) => m,
                Err(_) => {
                    self.send_json(
                        &out_tx,
                        &ServerMessage::Error {
                            reason: "invalid json".into(),
                            to: None,
                        },
                    );
                    continue;
                }
            };

            match parsed {
                ClientMessage::Subscribe if ui_only => {}
                ClientMessage::Register { .. } if ui_only => {}
                ClientMessage::Connect { a, b } if ui_only => {
                    if let Err(err) = self.connect(&a, &b) {
                        self.send_json(&out_tx, &err);
                    }
                }
                ClientMessage::Disconnect { a, b } if ui_only => {
                    self.disconnect(&a, &b);
                }
                ClientMessage::Msg { to, content } => {
                    let from = match &registered {
                        Some(n) => n.clone(),
                        None => continue,
                    };
                    if let Err(err) = self.route_msg(&from, &to, &content) {
                        self.send_json(&out_tx, &err);
                    }
                }
                _ => {
                    self.send_json(
                        &out_tx,
                        &ServerMessage::Error {
                            reason: "forbidden for this connection".into(),
                            to: None,
                        },
                    );
                }
            }
        }

        if let Some(name) = registered {
            self.unregister(&name);
        }
        drop(out_tx);
        let _ = writer.await;
    }
}
