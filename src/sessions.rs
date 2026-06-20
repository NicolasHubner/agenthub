use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerminalSession {
    pub id: String,
    pub name: String,
    pub command: String,
    pub cwd: String,
    #[serde(default)]
    pub preset: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanvasView {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CanvasWidget {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionSnapshot {
    #[serde(default)]
    pub terminals: Vec<TerminalSession>,
    #[serde(default)]
    pub widgets: Vec<CanvasWidget>,
    #[serde(default)]
    pub edges: Vec<[String; 2]>,
    #[serde(default, rename = "widgetEdges")]
    pub widget_edges: Vec<[String; 2]>,
    #[serde(default)]
    pub view: Option<CanvasView>,
}

pub struct SessionStore {
    path: PathBuf,
    data: Mutex<SessionSnapshot>,
}

impl SessionStore {
    /// Store at `<workspace_root>/.agenthub/sessions.json` (legacy layout).
    pub fn new(workspace_root: &Path) -> Self {
        Self::new_in(&workspace_root.join(".agenthub"))
    }

    /// Store at `<state_dir>/sessions.json` (global per-workspace layout).
    pub fn new_in(state_dir: &Path) -> Self {
        let path = state_dir.join("sessions.json");
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            SessionSnapshot::default()
        };
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self) -> SessionSnapshot {
        self.data.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn save(&self, snap: SessionSnapshot) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&snap).expect("sessions serialize");
        fs::write(&self.path, json)?;
        *self.data.lock().unwrap_or_else(|e| e.into_inner()) = snap;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_in_uses_dir_directly() {
        let dir = std::env::temp_dir().join(format!("agenthub-sess-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = SessionStore::new_in(&dir);
        store.save(SessionSnapshot::default()).unwrap();
        assert!(dir.join("sessions.json").exists());
    }
}
