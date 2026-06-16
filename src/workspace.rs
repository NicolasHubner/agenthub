use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum WorkspaceError {
    NotFound,
    Forbidden,
    TooLarge,
    NotText,
    Io(std::io::Error),
}

pub struct Workspace {
    root: PathBuf,
}

impl Workspace {
    /// Build a workspace from a root dir, storing its canonical path.
    pub fn new(root: impl AsRef<Path>) -> std::io::Result<Self> {
        Ok(Self { root: root.as_ref().canonicalize()? })
    }

    /// Resolve a caller-supplied relative path against the root, rejecting
    /// anything that escapes the root (`..`, symlink, absolute path).
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, WorkspaceError> {
        // Reject absolute inputs outright; everything must be relative to root.
        if Path::new(rel).is_absolute() {
            return Err(WorkspaceError::Forbidden);
        }
        let candidate = self.root.join(rel);
        // canonicalize resolves `..` and symlinks, and errors if the target
        // does not exist — which we map to NotFound.
        let canonical = candidate
            .canonicalize()
            .map_err(|_| WorkspaceError::NotFound)?;
        if !canonical.starts_with(&self.root) {
            return Err(WorkspaceError::Forbidden);
        }
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root() -> PathBuf {
        // Unique dir under the system temp folder. No external crate needed.
        let base = std::env::temp_dir().join("agenthub-test");
        let dir = base.join(format!("ws-{}", std::process::id()));
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::write(dir.join("docs/a.md"), "# hello").unwrap();
        dir
    }

    #[test]
    fn resolves_file_inside_root() {
        let root = temp_root();
        let ws = Workspace::new(&root).unwrap();
        let p = ws.resolve("docs/a.md").unwrap();
        assert!(p.ends_with("docs/a.md"));
        assert!(p.starts_with(root.canonicalize().unwrap()));
    }

    #[test]
    fn rejects_parent_traversal() {
        let ws = Workspace::new(temp_root()).unwrap();
        assert!(matches!(ws.resolve("../../etc/passwd"), Err(WorkspaceError::Forbidden) | Err(WorkspaceError::NotFound)));
    }

    #[test]
    fn rejects_absolute_path() {
        let ws = Workspace::new(temp_root()).unwrap();
        assert!(matches!(ws.resolve("/etc/passwd"), Err(WorkspaceError::Forbidden) | Err(WorkspaceError::NotFound)));
    }

    #[test]
    fn missing_file_is_not_found() {
        let ws = Workspace::new(temp_root()).unwrap();
        assert!(matches!(ws.resolve("docs/missing.md"), Err(WorkspaceError::NotFound)));
    }
}
