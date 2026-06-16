# AgentHub — Doc Viewer (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a browser at `localhost:3000`, browse the project's files in a clickable tree, click a file, and read it rendered (markdown formatted, code highlighted) — served by a single Rust binary. No external tool, no tmux pain.

**Architecture:** One Rust binary (`agenthub`) built on `axum`. It exposes a read-only file API (`GET /files`, `GET /file?path=`) scoped to a workspace root, with a path-traversal guard, and serves a static React build with SPA fallback. The React app (Vite + TS) fetches the file list, renders a tree, and renders the selected file with `react-markdown` (markdown) or `react-syntax-highlighter` (code). This is Slice 1 of AgentHub — later slices add the WebSocket agent-messaging hub and the node-graph UI on top of the same binary/app.

**Tech Stack:** Rust (`axum` 0.7, `tokio`, `tower-http`, `serde`, `serde_json`, `walkdir`), React + Vite + TypeScript (`react-markdown`, `remark-gfm`, `react-syntax-highlighter`), Vitest + Testing Library.

---

## Scope

In: file-list API, single-file API with security guard, static UI serving, React tree + viewer (markdown/code render), read-only.

Out (later slices): WebSocket protocol, agent registry/broker/edges, node-graph UI, MCP server, terminal wrapper, editing files in the browser.

## File Structure

Rust hub (`/home/nicolas/agenthub/`):
- `Cargo.toml` — crate manifest + deps.
- `src/main.rs` — bootstrap: read config (workspace root, ui dir, port), build router, bind, serve.
- `src/workspace.rs` — `Workspace` (canonical root), `resolve()` path guard, `list_files()`, `read_file()`, `WorkspaceError`. All core logic + security; heavily unit-tested.
- `src/routes.rs` — axum handlers (`get_files`, `get_file`), `ApiError → IntoResponse`, router builder `api_router()`.
- `tests/api.rs` — integration tests hitting the router via `oneshot`.

React UI (`/home/nicolas/agenthub/ui/`):
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`.
- `src/main.tsx` — React entry.
- `src/api.ts` — `getFiles()`, `getFile(path)` typed fetch wrappers.
- `src/FileTree.tsx` — build nested tree from flat path list, render, `onSelect`.
- `src/Viewer.tsx` — render a `FileContent` as markdown or highlighted code.
- `src/App.tsx` — layout (tree left, viewer right), load list on mount, wire selection.
- `src/*.test.ts(x)` — Vitest unit/smoke tests.
- `vitest.setup.ts` — Testing Library + jsdom setup.

## Conventions used across tasks

- Run all Rust commands from `/home/nicolas/agenthub`.
- Run all UI commands from `/home/nicolas/agenthub/ui`.
- Workspace root defaults to the current directory, override with env `AGENTHUB_WORKSPACE`.
- UI build dir defaults to `ui/dist`, override with env `AGENTHUB_UI_DIR`.
- HTTP port defaults to `3000`, override with env `AGENTHUB_PORT`.
- `/files` response shape: `{ "files": ["docs/a.md", "src/main.rs", ...] }` (relative paths, sorted, files only).
- `/file?path=<rel>` response shape: `{ "path": "<rel>", "content": "<utf8>", "kind": "markdown"|"code"|"text", "ext": "<ext>" }`.
- Error status mapping: outside-root/`..`/absolute → 403, missing → 404, > 2 MiB → 413, non-UTF8/binary → 415.

---

## Part A — Rust hub foundation

### Task 1: Cargo project + dependencies + hello server

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
/target
/ui/node_modules
/ui/dist
```

- [ ] **Step 2: Create `Cargo.toml`**

```toml
[package]
name = "agenthub"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.5", features = ["fs"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
walkdir = "2"

[dev-dependencies]
tower = { version = "0.4", features = ["util"] }
```

- [ ] **Step 3: Create a minimal `src/main.rs` that boots a server**

```rust
use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/health", get(|| async { "ok" }));
    let port: u16 = std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("agenthub listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve");
}
```

- [ ] **Step 4: Build to verify the toolchain and deps resolve**

Run: `cargo build`
Expected: compiles, ends with `Finished`.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock src/main.rs .gitignore
git commit -m "feat: bootstrap agenthub axum server with /health"
```

---

### Task 2: Workspace path-resolution guard (security core)

**Files:**
- Create: `src/workspace.rs`
- Modify: `src/main.rs` (add `mod workspace;`)

- [ ] **Step 1: Add the module declaration to `src/main.rs`**

Add this line at the top of `src/main.rs`, above the `use` statements:

```rust
mod workspace;
```

- [ ] **Step 2: Write the failing tests in `src/workspace.rs`**

Create `src/workspace.rs` with the error type, a `Workspace` skeleton whose `resolve` is unimplemented, and the tests:

```rust
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
        todo!()
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test workspace::tests::resolves_file_inside_root`
Expected: FAIL — panics with `not yet implemented` (the `todo!()`).

- [ ] **Step 4: Implement `resolve`**

Replace the `todo!()` body of `resolve` with:

```rust
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test workspace::tests`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/workspace.rs src/main.rs
git commit -m "feat: workspace path-resolution guard against traversal"
```

---

### Task 3: List workspace files

**Files:**
- Modify: `src/workspace.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src/workspace.rs`:

```rust
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test workspace::tests::lists_files_relative_sorted_skips_ignored`
Expected: FAIL — `no method named list_files`.

- [ ] **Step 3: Implement `list_files`**

Add this method inside `impl Workspace`:

```rust
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
```

Add `use walkdir;` is not needed (it's an external crate referenced by full path). Ensure `walkdir` is in `Cargo.toml` (it is, from Task 1).

- [ ] **Step 4: Run it to verify it passes**

Run: `cargo test workspace::tests::lists_files_relative_sorted_skips_ignored`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.rs
git commit -m "feat: list workspace files with ignore set"
```

---

### Task 4: Read a single file (with size/binary guards)

**Files:**
- Modify: `src/workspace.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test workspace::tests::reads_markdown_file`
Expected: FAIL — `no method named read_file` and `FileContent` unknown.

- [ ] **Step 3: Implement `FileContent`, `read_file`, and `kind_for`**

Add near the top of `src/workspace.rs` (after the `use`):

```rust
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
```

Add this method inside `impl Workspace`:

```rust
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
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cargo test workspace::tests`
Expected: PASS — all workspace tests green.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.rs
git commit -m "feat: read workspace file with size and binary guards"
```

---

### Task 5: HTTP handlers + router for the file API

**Files:**
- Create: `src/routes.rs`
- Modify: `src/main.rs` (add `mod routes;`, mount router)

- [ ] **Step 1: Add module declaration to `src/main.rs`**

Add below `mod workspace;`:

```rust
mod routes;
```

- [ ] **Step 2: Create `src/routes.rs` with handlers and error mapping**

```rust
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::workspace::{Workspace, WorkspaceError};

pub type SharedWorkspace = Arc<Workspace>;

struct ApiError(StatusCode, &'static str);

impl From<WorkspaceError> for ApiError {
    fn from(e: WorkspaceError) -> Self {
        match e {
            WorkspaceError::Forbidden => ApiError(StatusCode::FORBIDDEN, "path outside workspace"),
            WorkspaceError::NotFound => ApiError(StatusCode::NOT_FOUND, "not found"),
            WorkspaceError::TooLarge => ApiError(StatusCode::PAYLOAD_TOO_LARGE, "file too large"),
            WorkspaceError::NotText => {
                ApiError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "not a text file")
            }
            WorkspaceError::Io(_) => ApiError(StatusCode::INTERNAL_SERVER_ERROR, "io error"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

async fn get_files(State(ws): State<SharedWorkspace>) -> Response {
    Json(json!({ "files": ws.list_files() })).into_response()
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

async fn get_file(
    State(ws): State<SharedWorkspace>,
    Query(q): Query<FileQuery>,
) -> Result<Json<crate::workspace::FileContent>, ApiError> {
    Ok(Json(ws.read_file(&q.path)?))
}

/// Router for just the JSON file API (no static serving). Used by main and tests.
pub fn api_router(ws: SharedWorkspace) -> Router {
    Router::new()
        .route("/files", get(get_files))
        .route("/file", get(get_file))
        .with_state(ws)
}
```

- [ ] **Step 3: Write the integration test in `tests/api.rs`**

Create `tests/api.rs`:

```rust
use std::fs;
use std::sync::Arc;

use agenthub::workspace::Workspace;
use agenthub::routes::api_router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt; // for `oneshot`

fn ws() -> Arc<Workspace> {
    let dir = std::env::temp_dir().join(format!("agenthub-it-{}", std::process::id()));
    fs::create_dir_all(dir.join("docs")).unwrap();
    fs::write(dir.join("docs/a.md"), "# hello").unwrap();
    Arc::new(Workspace::new(&dir).unwrap())
}

async fn body_string(resp: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn files_endpoint_lists_files() {
    let app = api_router(ws());
    let resp = app
        .oneshot(Request::builder().uri("/files").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(body_string(resp).await.contains("docs/a.md"));
}

#[tokio::test]
async fn file_endpoint_returns_content() {
    let app = api_router(ws());
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/file?path=docs/a.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(body_string(resp).await.contains("# hello"));
}

#[tokio::test]
async fn traversal_is_forbidden() {
    let app = api_router(ws());
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/file?path=../../etc/passwd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(matches!(resp.status(), StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
}
```

- [ ] **Step 4: Expose modules to integration tests via a lib target**

Integration tests in `tests/` need a library crate to import from. Create `src/lib.rs`:

```rust
pub mod routes;
pub mod workspace;
```

Then change `src/main.rs` to use the library crate instead of declaring the modules itself. Replace the `mod workspace;` and `mod routes;` lines in `src/main.rs` with:

```rust
use agenthub::routes;
use agenthub::workspace;
```

(Keep the rest of `main.rs` as-is for now; the next task rewrites its body.)

- [ ] **Step 5: Run the integration tests to verify they pass**

Run: `cargo test --test api`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes.rs src/lib.rs src/main.rs tests/api.rs
git commit -m "feat: file API handlers with error mapping and integration tests"
```

---

### Task 6: Wire config + mount API + serve static UI with SPA fallback

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: Rewrite `src/main.rs` to build the full app**

Replace the entire contents of `src/main.rs` with:

```rust
use std::sync::Arc;

use agenthub::routes::api_router;
use agenthub::workspace::Workspace;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    let workspace_root = std::env::var("AGENTHUB_WORKSPACE").unwrap_or_else(|_| ".".to_string());
    let ui_dir = std::env::var("AGENTHUB_UI_DIR").unwrap_or_else(|_| "ui/dist".to_string());
    let port: u16 = std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let ws = Arc::new(Workspace::new(&workspace_root).expect("workspace root must exist"));

    // Static UI with SPA fallback: unknown paths serve index.html.
    let index = format!("{ui_dir}/index.html");
    let static_service = ServeDir::new(&ui_dir).fallback(ServeFile::new(index));

    let app = api_router(ws).fallback_service(static_service);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("agenthub: serving {workspace_root} on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve");
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cargo build`
Expected: compiles cleanly.

- [ ] **Step 3: Smoke-test the API against the real workspace**

Start the server in the background, query it, then stop it:

```bash
AGENTHUB_WORKSPACE=. cargo run &
sleep 2
curl -s http://127.0.0.1:3000/files | head -c 300
curl -s "http://127.0.0.1:3000/file?path=docs/superpowers/specs/2026-06-16-agenthub-design.md" | head -c 120
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/file?path=../../etc/passwd"
kill %1
```

Expected: first curl shows a JSON `files` array including the spec path; second shows the spec's JSON `content`; third prints `403` (or `404`).

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: mount file API and serve static UI with SPA fallback"
```

---

## Part B — React viewer UI

### Task 7: Scaffold the Vite React TS app + Vitest

**Files:**
- Create: `ui/package.json`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/index.html`, `ui/vitest.setup.ts`
- Create: `ui/src/main.tsx`, `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/package.json`**

```json
{
  "name": "agenthub-ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "react-syntax-highlighter": "^15.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/react-syntax-highlighter": "^15.5.13",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.3",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `ui/vite.config.ts`**

The dev server proxies the API to the Rust binary so the UI can run hot-reloaded during development.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/files": "http://127.0.0.1:3000",
      "/file": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
});
```

- [ ] **Step 3: Create `ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

- [ ] **Step 4: Create `ui/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentHub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `ui/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 6: Create `ui/src/main.tsx` and a placeholder `ui/src/App.tsx`**

`ui/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`ui/src/App.tsx`:

```tsx
export function App() {
  return <div>AgentHub</div>;
}
```

- [ ] **Step 7: Install dependencies and verify the build**

Run:
```bash
cd /home/nicolas/agenthub/ui && npm install && npm run build
```
Expected: `npm install` completes; `npm run build` produces `ui/dist/index.html`.

- [ ] **Step 8: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/vite.config.ts ui/tsconfig.json ui/index.html ui/vitest.setup.ts ui/src/main.tsx ui/src/App.tsx
git commit -m "feat: scaffold React+Vite UI with Vitest"
```

---

### Task 8: API client (`api.ts`)

**Files:**
- Create: `ui/src/api.ts`
- Create: `ui/src/api.test.ts`

- [ ] **Step 1: Write the failing test `ui/src/api.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getFiles, getFile } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("getFiles returns the files array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ files: ["a.md", "b.rs"] }))),
    );
    expect(await getFiles()).toEqual(["a.md", "b.rs"]);
  });

  it("getFile fetches by encoded path and returns content", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ path: "a.md", content: "# hi", kind: "markdown", ext: "md" }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const f = await getFile("docs/a b.md");
    expect(f.content).toBe("# hi");
    expect(fetchMock).toHaveBeenCalledWith("/file?path=docs%2Fa%20b.md");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/api.test.ts`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Implement `ui/src/api.ts`**

```ts
export type FileKind = "markdown" | "code" | "text";

export interface FileContent {
  path: string;
  content: string;
  kind: FileKind;
  ext: string;
}

export async function getFiles(): Promise<string[]> {
  const res = await fetch("/files");
  if (!res.ok) throw new Error(`/files ${res.status}`);
  const data = (await res.json()) as { files: string[] };
  return data.files;
}

export async function getFile(path: string): Promise<FileContent> {
  const res = await fetch(`/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`/file ${res.status}`);
  return (await res.json()) as FileContent;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/api.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api.ts ui/src/api.test.ts
git commit -m "feat: typed file API client"
```

---

### Task 9: File tree (`FileTree.tsx`)

**Files:**
- Create: `ui/src/tree.ts` (pure path→tree builder)
- Create: `ui/src/tree.test.ts`
- Create: `ui/src/FileTree.tsx`
- Create: `ui/src/FileTree.test.tsx`

- [ ] **Step 1: Write the failing test for the tree builder `ui/src/tree.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildTree } from "./tree";

describe("buildTree", () => {
  it("nests files under directories", () => {
    const tree = buildTree(["docs/a.md", "docs/sub/b.md", "main.rs"]);
    expect(tree).toEqual([
      {
        name: "docs",
        path: "docs",
        children: [
          {
            name: "sub",
            path: "docs/sub",
            children: [{ name: "b.md", path: "docs/sub/b.md", children: null }],
          },
          { name: "a.md", path: "docs/a.md", children: null },
        ],
      },
      { name: "main.rs", path: "main.rs", children: null },
    ]);
  });
});
```

Note: directories sort before files, each group alphabetical. The implementation must produce exactly this order.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/tree.test.ts`
Expected: FAIL — cannot resolve `./tree`.

- [ ] **Step 3: Implement `ui/src/tree.ts`**

```ts
export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null; // null = file, array = directory
}

interface DirAcc {
  name: string;
  path: string;
  dirs: Map<string, DirAcc>;
  files: string[];
}

function emptyDir(name: string, path: string): DirAcc {
  return { name, path, dirs: new Map(), files: [] };
}

export function buildTree(paths: string[]): TreeNode[] {
  const root = emptyDir("", "");
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const path = cur.path ? `${cur.path}/${name}` : name;
      if (!cur.dirs.has(name)) cur.dirs.set(name, emptyDir(name, path));
      cur = cur.dirs.get(name)!;
    }
    cur.files.push(parts[parts.length - 1]);
  }
  return toNodes(root);
}

function toNodes(dir: DirAcc): TreeNode[] {
  const dirNodes = [...dir.dirs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ name: d.name, path: d.path, children: toNodes(d) }));
  const fileNodes = dir.files
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({
      name: f,
      path: dir.path ? `${dir.path}/${f}` : f,
      children: null as TreeNode[] | null,
    }));
  return [...dirNodes, ...fileNodes];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test `ui/src/FileTree.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  it("renders file names and fires onSelect with the path", () => {
    const onSelect = vi.fn();
    render(<FileTree files={["docs/a.md", "main.rs"]} onSelect={onSelect} />);
    expect(screen.getByText("main.rs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("main.rs"));
    expect(onSelect).toHaveBeenCalledWith("main.rs");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/FileTree.test.tsx`
Expected: FAIL — cannot resolve `./FileTree`.

- [ ] **Step 7: Implement `ui/src/FileTree.tsx`**

```tsx
import { buildTree, type TreeNode } from "./tree";

interface Props {
  files: string[];
  onSelect: (path: string) => void;
}

function Node({ node, onSelect }: { node: TreeNode; onSelect: (p: string) => void }) {
  if (node.children === null) {
    return (
      <li>
        <button className="file" onClick={() => onSelect(node.path)}>
          {node.name}
        </button>
      </li>
    );
  }
  return (
    <li>
      <span className="dir">{node.name}/</span>
      <ul>
        {node.children.map((c) => (
          <Node key={c.path} node={c} onSelect={onSelect} />
        ))}
      </ul>
    </li>
  );
}

export function FileTree({ files, onSelect }: Props) {
  const tree = buildTree(files);
  return (
    <ul className="tree">
      {tree.map((n) => (
        <Node key={n.path} node={n} onSelect={onSelect} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/FileTree.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/tree.ts ui/src/tree.test.ts ui/src/FileTree.tsx ui/src/FileTree.test.tsx
git commit -m "feat: file tree builder and component"
```

---

### Task 10: Content viewer (`Viewer.tsx`)

**Files:**
- Create: `ui/src/Viewer.tsx`
- Create: `ui/src/Viewer.test.tsx`

- [ ] **Step 1: Write the failing test `ui/src/Viewer.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Viewer } from "./Viewer";

describe("Viewer", () => {
  it("renders markdown headings as html", () => {
    render(
      <Viewer file={{ path: "a.md", content: "# Title", kind: "markdown", ext: "md" }} />,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
  });

  it("renders code content verbatim", () => {
    render(
      <Viewer file={{ path: "m.rs", content: "fn main() {}", kind: "code", ext: "rs" }} />,
    );
    expect(screen.getByText(/fn main/)).toBeInTheDocument();
  });

  it("shows a placeholder when no file is selected", () => {
    render(<Viewer file={null} />);
    expect(screen.getByText(/select a file/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/Viewer.test.tsx`
Expected: FAIL — cannot resolve `./Viewer`.

- [ ] **Step 3: Implement `ui/src/Viewer.tsx`**

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { FileContent } from "./api";

export function Viewer({ file }: { file: FileContent | null }) {
  if (!file) return <div className="viewer empty">Select a file to view it.</div>;

  if (file.kind === "markdown") {
    return (
      <div className="viewer markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{file.content}</Markdown>
      </div>
    );
  }

  if (file.kind === "code") {
    return (
      <div className="viewer code">
        <SyntaxHighlighter language={file.ext} wrapLongLines>
          {file.content}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className="viewer text">
      <pre>{file.content}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /home/nicolas/agenthub/ui && npx vitest run src/Viewer.test.tsx`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/Viewer.tsx ui/src/Viewer.test.tsx
git commit -m "feat: content viewer for markdown, code, and text"
```

---

### Task 11: Compose `App.tsx` (tree + viewer, load + select)

**Files:**
- Modify: `ui/src/App.tsx`
- Create: `ui/src/App.css`
- Modify: `ui/src/main.tsx` (import the css)

- [ ] **Step 1: Replace `ui/src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getFiles, getFile, type FileContent } from "./api";
import { FileTree } from "./FileTree";
import { Viewer } from "./Viewer";

export function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFiles().then(setFiles).catch((e) => setError(String(e)));
  }, []);

  async function open(path: string) {
    try {
      setSelected(await getFile(path));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>AgentHub</h1>
        {error && <p className="error">{error}</p>}
        <FileTree files={files} onSelect={open} />
      </aside>
      <main className="content">
        <Viewer file={selected} />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `ui/src/App.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
.layout { display: flex; height: 100vh; }
.sidebar {
  width: 300px; min-width: 300px; overflow: auto;
  border-right: 1px solid #ddd; padding: 12px; background: #fafafa;
}
.sidebar h1 { font-size: 16px; margin: 0 0 12px; }
.content { flex: 1; overflow: auto; padding: 24px; }
.tree, .tree ul { list-style: none; margin: 0; padding-left: 12px; }
.tree .dir { font-weight: 600; color: #444; }
.tree .file {
  background: none; border: none; cursor: pointer; padding: 2px 4px;
  color: #0366d6; font: inherit; text-align: left;
}
.tree .file:hover { text-decoration: underline; }
.viewer.empty { color: #888; }
.viewer pre { white-space: pre-wrap; }
.error { color: #c00; }
```

- [ ] **Step 2b: Import the css in `ui/src/main.tsx`**

Add this import line at the top of `ui/src/main.tsx`, after the React imports:

```tsx
import "./App.css";
```

- [ ] **Step 3: Run the full UI test suite + build**

Run:
```bash
cd /home/nicolas/agenthub/ui && npm run test && npm run build
```
Expected: all Vitest tests pass; `vite build` writes `ui/dist`.

- [ ] **Step 4: Commit**

```bash
git add ui/src/App.tsx ui/src/App.css ui/src/main.tsx
git commit -m "feat: compose doc-viewer app layout"
```

---

### Task 12: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build the UI**

Run: `cd /home/nicolas/agenthub/ui && npm run build`
Expected: `ui/dist/index.html` exists.

- [ ] **Step 2: Run the binary against the repo and open it**

Run from `/home/nicolas/agenthub`:
```bash
AGENTHUB_WORKSPACE=. cargo run
```
Then open `http://127.0.0.1:3000` in a browser.

- [ ] **Step 3: Verify the flow**

- The sidebar lists the repo files (including `docs/superpowers/specs/2026-06-16-agenthub-design.md`).
- Clicking the spec renders it as formatted markdown (headings, code blocks), not raw text.
- Clicking `src/main.rs` shows highlighted Rust code.
- In a terminal, confirm traversal is blocked: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/file?path=../../etc/passwd"` prints `403` or `404`.

- [ ] **Step 4: Stop the server** with Ctrl-C.

- [ ] **Step 5: Add a short README and commit**

Create `/home/nicolas/agenthub/README.md`:

```markdown
# AgentHub

Local hub to connect independent AI agents on demand, with an integrated
file/doc viewer in the browser.

## Slice 1 — Doc Viewer (current)

Run:

    cd ui && npm install && npm run build && cd ..
    AGENTHUB_WORKSPACE=. cargo run

Open http://127.0.0.1:3000 and browse the workspace.

Config: `AGENTHUB_WORKSPACE` (root to serve, default `.`),
`AGENTHUB_UI_DIR` (built UI, default `ui/dist`), `AGENTHUB_PORT` (default 3000).

Next slices: WebSocket agent messaging, node-graph UI, MCP + terminal adapters.
```

```bash
git add README.md
git commit -m "docs: add README for doc-viewer slice"
```

---

## Self-Review

**Spec coverage (Slice 1 scope):**
- Viewer integrado na UI web → Tasks 7–12. ✓
- Árvore de arquivos clicável → Tasks 9, 11. ✓
- Render markdown + código (syntax highlight) → Task 10. ✓
- `GET /files` (árvore) → Tasks 3, 5. ✓
- `GET /file?path=` (conteúdo) → Tasks 4, 5. ✓
- Path guard contra `..`/symlink/absoluto → 403; missing → 404; grande → 413; binário → 415 → Tasks 2, 4, 5. ✓
- Read-only no MVP → no write endpoint exists. ✓
- Servir UI estática (axum), porta 3000 → Task 6. ✓
- Stack: axum/tokio/serde/serde_json (+walkdir, tower-http) e Vite/React/react-markdown/syntax-highlighter → Tasks 1, 7. ✓

Spec items intentionally deferred to later slices (not gaps): WebSocket protocol, Registry, Broker, edges, node-graph UI, MCP server, terminal wrapper, broadcast/msg routing. These are Slice 2 / Slice 3.

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `Workspace`, `WorkspaceError`, `FileContent` (Rust) used consistently across Tasks 2–6. `FileContent`/`FileKind`, `getFiles`/`getFile`, `buildTree`/`TreeNode`, `FileTree`, `Viewer` (TS) consistent across Tasks 8–11. `api_router` defined in Task 5, used in Task 6 and tests. `/files` returns `{files:[...]}` and `/file` returns the `FileContent` object — both consumed exactly that way in `api.ts`. ✓
