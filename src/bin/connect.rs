use std::env;
use std::io::{self, BufRead, Write};

use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    let mut name = String::from("agent");
    let mut hub_url = String::from("ws://127.0.0.1:3000/ws");
    let mut default_to = String::from("*");
    let mut tags: Vec<String> = vec![];

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--name" | "-n" => {
                i += 1;
                name = args.get(i).cloned().unwrap_or(name);
            }
            "--hub" | "-u" => {
                i += 1;
                hub_url = args.get(i).cloned().unwrap_or(hub_url);
            }
            "--to" | "-t" => {
                i += 1;
                default_to = args.get(i).cloned().unwrap_or(default_to);
            }
            "--tag" => {
                i += 1;
                if let Some(t) = args.get(i) {
                    tags.push(t.clone());
                }
            }
            "--help" | "-h" => {
                eprintln!(
                    "usage: agenthub-connect --name NAME [--hub URL] [--to AGENT] [--tag TAG]...\n\
                     Reads stdin lines and sends as hub messages. Incoming messages print to stdout."
                );
                return;
            }
            _ => break,
        }
        i += 1;
    }

    let register = serde_json::json!({
        "type": "register",
        "name": name,
        "tags": tags,
    });

    let (ws, _) = connect_async(&hub_url).await.expect("connect to hub");
    let (mut tx, mut rx) = ws.split();
    tx.send(Message::Text(register.to_string()))
        .await
        .expect("register");

    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let default_to_clone = default_to.clone();
    let send_task = tokio::spawn(async move {
        while let Some(line) = stdin_rx.recv().await {
            if line.trim().is_empty() {
                continue;
            }
            let msg = serde_json::json!({
                "type": "msg",
                "to": default_to_clone,
                "content": line,
            });
            if tx.send(Message::Text(msg.to_string())).await.is_err() {
                break;
            }
        }
    });

    tokio::task::spawn_blocking(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(l) => {
                    if stdin_tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut stdout = io::stdout();
    while let Some(Ok(msg)) = rx.next().await {
        if let Message::Text(text) = msg {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v.get("type").and_then(|t| t.as_str()) == Some("msg") {
                    let _ = writeln!(
                        stdout,
                        "[{}] {}",
                        v.get("from").and_then(|f| f.as_str()).unwrap_or("?"),
                        v.get("content").and_then(|c| c.as_str()).unwrap_or("")
                    );
                    let _ = stdout.flush();
                }
            }
        }
    }

    let _ = send_task.await;
}
