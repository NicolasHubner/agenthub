use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

/// User home, cross-platform, with a root fallback so the server still starts.
pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn agenthub_home() -> PathBuf {
    home_dir().join(".agenthub")
}

pub fn workspace_state_dir(id: &str) -> PathBuf {
    agenthub_home().join("workspaces").join(id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RegistryData {
    #[serde(default)]
    active: String,
    #[serde(default)]
    workspaces: Vec<WorkspaceEntry>,
}

pub struct Registry {
    path: PathBuf,
    data: Mutex<RegistryData>,
}

impl Registry {
    pub fn open(path: PathBuf) -> Self {
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, data: Mutex::new(data) }
    }

    pub fn default_path() -> PathBuf {
        agenthub_home().join("workspaces.json")
    }

    fn persist(&self, data: &RegistryData) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    fn next_id(data: &RegistryData) -> String {
        let max = data
            .workspaces
            .iter()
            .filter_map(|w| w.id.strip_prefix("ws-").and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0);
        format!("ws-{:02}", max + 1)
    }

    pub fn seed_if_empty(&self, seed_dir: &Path) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if !data.workspaces.is_empty() {
            return;
        }
        let folder = seed_dir
            .canonicalize()
            .unwrap_or_else(|_| seed_dir.to_path_buf())
            .display()
            .to_string();
        let id = "ws-01".to_string();
        data.workspaces.push(WorkspaceEntry {
            id: id.clone(),
            name: "Workspace 01".into(),
            folders: vec![folder],
        });
        data.active = id;
        self.persist(&data);
    }

    pub fn snapshot(&self) -> (String, Vec<WorkspaceEntry>) {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        (data.active.clone(), data.workspaces.clone())
    }

    pub fn entry(&self, id: &str) -> Option<WorkspaceEntry> {
        self.data.lock().unwrap_or_else(|e| e.into_inner()).workspaces.iter().find(|w| w.id == id).cloned()
    }

    pub fn active_entry(&self) -> Option<WorkspaceEntry> {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.workspaces.iter().find(|w| w.id == data.active).cloned()
    }

    pub fn create(&self, name: Option<String>, folder: String) -> WorkspaceEntry {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let id = Self::next_id(&data);
        let n = id.strip_prefix("ws-").unwrap_or("");
        let entry = WorkspaceEntry {
            id: id.clone(),
            name: name.unwrap_or_else(|| format!("Workspace {n}")),
            folders: vec![folder],
        };
        data.workspaces.push(entry.clone());
        data.active = id;
        self.persist(&data);
        entry
    }

    pub fn set_active(&self, id: &str) -> bool {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if data.workspaces.iter().any(|w| w.id == id) {
            data.active = id.to_string();
            self.persist(&data);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, id: &str) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        data.workspaces.retain(|w| w.id != id);
        if data.active == id {
            data.active = data.workspaces.first().map(|w| w.id.clone()).unwrap_or_default();
        }
        self.persist(&data);
    }

    pub fn rename(&self, id: &str, name: String) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            w.name = name;
        }
        self.persist(&data);
    }

    pub fn add_folder(&self, id: &str, dir: String) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            if !w.folders.contains(&dir) {
                w.folders.push(dir);
            }
        }
        self.persist(&data);
    }

    pub fn remove_folder(&self, id: &str, dir: &str) {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            w.folders.retain(|f| f != dir);
        }
        self.persist(&data);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static C: AtomicU64 = AtomicU64::new(0);
        let id = C.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("agenthub-reg-{}-{}", std::process::id(), id));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn seeds_first_workspace_from_dir() {
        let base = tmp();
        let reg = Registry::open(base.join("workspaces.json"));
        reg.seed_if_empty(&base);
        let (active, list) = reg.snapshot();
        assert_eq!(active, "ws-01");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Workspace 01");
        assert_eq!(list[0].folders.len(), 1);
    }

    #[test]
    fn create_assigns_sequential_ids_and_persists() {
        let base = tmp();
        let path = base.join("workspaces.json");
        let reg = Registry::open(path.clone());
        reg.seed_if_empty(&base);
        let e = reg.create(None, base.canonicalize().unwrap().display().to_string());
        assert_eq!(e.id, "ws-02");
        assert_eq!(e.name, "Workspace 02");
        // reload from disk: state persisted
        let reg2 = Registry::open(path);
        assert_eq!(reg2.snapshot().1.len(), 2);
    }

    #[test]
    fn add_folder_is_idempotent() {
        let base = tmp();
        let reg = Registry::open(base.join("workspaces.json"));
        reg.seed_if_empty(&base);
        reg.add_folder("ws-01", "/some/dir".into());
        reg.add_folder("ws-01", "/some/dir".into());
        let n = reg.entry("ws-01").unwrap().folders.len();
        assert_eq!(n, 2); // seed folder + one unique add
    }

    #[test]
    fn set_active_and_remove() {
        let base = tmp();
        let reg = Registry::open(base.join("workspaces.json"));
        reg.seed_if_empty(&base);
        let e = reg.create(None, base.canonicalize().unwrap().display().to_string());
        assert!(reg.set_active(&e.id));
        assert_eq!(reg.snapshot().0, e.id);
        reg.remove(&e.id);
        assert_eq!(reg.snapshot().1.len(), 1);
        assert_eq!(reg.snapshot().0, "ws-01"); // active falls back to a survivor
    }
}
