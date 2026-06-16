use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Register {
        name: String,
        #[serde(default)]
        tags: Vec<String>,
    },
    Subscribe,
    Msg {
        to: String,
        content: String,
    },
    Connect {
        a: String,
        b: String,
    },
    Disconnect {
        a: String,
        b: String,
    },
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    State {
        agents: Vec<AgentSnapshot>,
        edges: Vec<[String; 2]>,
    },
    Msg {
        from: String,
        to: String,
        content: String,
    },
    Error {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        to: Option<String>,
    },
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct AgentSnapshot {
    pub name: String,
    pub connected: bool,
    pub tags: Vec<String>,
}
