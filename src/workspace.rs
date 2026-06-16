use std::path::{Path, PathBuf};
use serde::Serialize;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub kind: String,
    pub ext: String,
}

fn kind_for(ext: &str) -> &'static str {
    match ext {
        "md" | "markdown" => "markdown",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "toml" | "yaml" | "yml" | "py" | "sh"
        | "css" | "html" | "go" | "c" | "cpp" | "h" => "code",
        _ => "text",
    }
}

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

    /// Relative paths of all files under the root, sorted, skipping noise dirs.
    pub fn list_files(&self) -> Vec<String> {
        const IGNORE: &[&str] = &[".git", "target", "node_modules", "dist", ".DS_Store"];
        let mut out: Vec<String> = walkdir::WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !IGNORE.contains(&name.as_ref()) && !name.starts_with('.')
                    || e.depth() == 0
            })
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                e.path()
                    .strip_prefix(&self.root)
                    .ok()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
            })
            .collect();
        out.sort();
        out
    }

    /// Read a workspace file as UTF-8 text, guarding size and binary content.
    pub fn read_file(&self, rel: &str) -> Result<FileContent, WorkspaceError> {
        let abs = self.resolve(rel)?;
        let meta = std::fs::metadata(&abs).map_err(WorkspaceError::Io)?;
        if !meta.is_file() {
            return Err(WorkspaceError::NotFound);
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(WorkspaceError::TooLarge);
        }
        let bytes = std::fs::read(&abs).map_err(WorkspaceError::Io)?;
        let content = String::from_utf8(bytes).map_err(|_| WorkspaceError::NotText)?;
        let ext = abs
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        Ok(FileContent {
            path: rel.to_string(),
            kind: kind_for(&ext).to_string(),
            ext,
            content,
        })
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
        use std::sync::atomic::{AtomicU64, Ordering};
        static CTR: AtomicU64 = AtomicU64::new(0);
        // Unique dir per call so parallel tests don't share state.
        let id = CTR.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join("agenthub-test");
        let dir = base.join(format!("ws-{}-{}", std::process::id(), id));
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

    #[test]
    fn lists_files_relative_sorted_skips_ignored() {
        let root = temp_root();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join("target/junk.o"), "x").unwrap();
        fs::write(root.join("README.md"), "x").unwrap();
        let ws = Workspace::new(&root).unwrap();
        let files = ws.list_files();
        assert!(files.contains(&"README.md".to_string()));
        assert!(files.contains(&"docs/a.md".to_string()));
        assert!(!files.iter().any(|f| f.starts_with("target/")));
        // sorted
        let mut sorted = files.clone();
        sorted.sort();
        assert_eq!(files, sorted);
    }

    #[test]
    fn reads_markdown_file() {
        let ws = Workspace::new(temp_root()).unwrap();
        let f = ws.read_file("docs/a.md").unwrap();
        assert_eq!(f.content, "# hello");
        assert_eq!(f.kind, "markdown");
        assert_eq!(f.ext, "md");
    }

    #[test]
    fn rejects_too_large_file() {
        let root = temp_root();
        let big = vec![b'a'; 3 * 1024 * 1024]; // 3 MiB > 2 MiB cap
        fs::write(root.join("big.txt"), &big).unwrap();
        let ws = Workspace::new(&root).unwrap();
        assert!(matches!(ws.read_file("big.txt"), Err(WorkspaceError::TooLarge)));
    }

    #[test]
    fn rejects_binary_file() {
        let root = temp_root();
        fs::write(root.join("bin.dat"), [0u8, 159, 146, 150]).unwrap(); // invalid UTF-8
        let ws = Workspace::new(&root).unwrap();
        assert!(matches!(ws.read_file("bin.dat"), Err(WorkspaceError::NotText)));
    }
}
