use std::path::PathBuf;

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
