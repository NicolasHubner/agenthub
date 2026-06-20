# IDE Editor + Folder-Addressed File API — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only, black-on-black file viewer into a real CodeMirror editor (Dracula, line numbers, save-to-disk), and reshape the file API so every file is addressed by `(root, path)` — the foundation multi-folder workspaces (Plan 2) builds on.

**Architecture:** The backend keeps `Workspace` as a single-root sandbox but the request state becomes an `ActiveWorkspace` holding a `Vec<Arc<Workspace>>` (one folder; Plan 2 grows it to N) behind an `Arc<RwLock<…>>`. `/files` returns files grouped per folder; `/file` and the new `PUT /file` take `root` + `path`. The frontend replaces `Viewer.tsx` with a CodeMirror editor and rebuilds the file tree as a multi-root, collapsible explorer.

**Tech Stack:** Rust (axum, tokio), React 18 + Vite + Vitest, CodeMirror 6 (`@uiw/react-codemirror`, `@uiw/codemirror-theme-dracula`, `@uiw/codemirror-extensions-langs`).

## Global Constraints

- Path-traversal guard is non-negotiable: every file read/write resolves through `Workspace::resolve`, which canonicalizes and rejects targets outside the root. `root` query params must match a folder in the active workspace or return `403`.
- File size cap: `MAX_FILE_BYTES = 2 MiB` applies to writes as well as reads.
- Editor edits existing files only — no file creation/rename/delete from the UI.
- Backend bound to `127.0.0.1` only.
- Run Rust tests with `cargo test`; run frontend tests with `npm --prefix ui test` (vitest, non-watch).
- Conventional Commits for every commit. Frequent commits (one per task minimum).

---

## Phase A — Backend: folder-addressed file API

### Task A1: `Workspace::write_file`

**Files:**
- Modify: `src/workspace.rs` (add method after `read_file`, ~line 88; add tests in the `tests` module)
- Test: `src/workspace.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: existing `Workspace::resolve(&self, rel) -> Result<PathBuf, WorkspaceError>` (already rejects traversal and missing files), `MAX_FILE_BYTES`, `WorkspaceError`.
- Produces: `pub fn write_file(&self, rel: &str, content: &str) -> Result<(), WorkspaceError>`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src/workspace.rs`:

```rust
#[test]
fn writes_existing_file_inside_root() {
    let root = temp_root();
    let ws = Workspace::new(&root).unwrap();
    ws.write_file("docs/a.md", "# changed").unwrap();
    let back = ws.read_file("docs/a.md").unwrap();
    assert_eq!(back.content, "# changed");
}

#[test]
fn write_rejects_traversal() {
    let ws = Workspace::new(temp_root()).unwrap();
    assert!(matches!(
        ws.write_file("../../tmp/evil.txt", "x"),
        Err(WorkspaceError::Forbidden) | Err(WorkspaceError::NotFound)
    ));
}

#[test]
fn write_rejects_too_large() {
    let root = temp_root();
    let ws = Workspace::new(&root).unwrap();
    let big = "a".repeat(3 * 1024 * 1024); // 3 MiB > 2 MiB cap
    assert!(matches!(ws.write_file("docs/a.md", &big), Err(WorkspaceError::TooLarge)));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib write_`
Expected: FAIL — `no method named write_file`.

- [ ] **Step 3: Implement `write_file`**

Add after `read_file` in `src/workspace.rs`:

```rust
/// Overwrite an existing workspace file with UTF-8 text. Edit-only: the
/// target must already exist inside the root (resolve() enforces both).
pub fn write_file(&self, rel: &str, content: &str) -> Result<(), WorkspaceError> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(WorkspaceError::TooLarge);
    }
    let abs = self.resolve(rel)?; // canonicalizes, rejects traversal + missing
    let meta = std::fs::metadata(&abs).map_err(WorkspaceError::Io)?;
    if !meta.is_file() {
        return Err(WorkspaceError::NotFound);
    }
    std::fs::write(&abs, content).map_err(WorkspaceError::Io)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib write_`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspace.rs
git commit -m "feat(workspace): add write_file for editing existing files"
```

---

### Task A2: Refactor request state to `ActiveWorkspace` (pure refactor)

Introduce the multi-folder-capable state holding exactly one folder, preserving current `/files` and `/file` responses so existing tests stay green.

**Files:**
- Modify: `src/routes.rs` (AppState, app_router, api_router, all handlers using `state.workspace`/`state.sessions`)
- Modify: `src/main.rs:18-25` (build `ActiveWorkspace`)
- Modify: `src/pty.rs:173,192` (`handle_pty_socket` takes folders; cwd validated across folders)

**Interfaces:**
- Produces:
  - `pub struct ActiveWorkspace { pub id: String, pub folders: Vec<Arc<Workspace>>, pub sessions: Arc<SessionStore> }`
  - `impl ActiveWorkspace { pub fn folder(&self, root: &str) -> Option<Arc<Workspace>>; pub fn primary(&self) -> Arc<Workspace>; pub fn resolve_dir_any(&self, path: &str) -> Result<PathBuf, WorkspaceError>; }`
  - `pub type SharedActive = Arc<RwLock<ActiveWorkspace>>`
  - `pub fn app_router(active: SharedActive, hub: SharedHub) -> Router`
  - `pub fn api_router(ws: Arc<Workspace>) -> Router` (unchanged signature — builds a single-folder `ActiveWorkspace` internally)
- Consumes: `Workspace`, `SessionStore`, `Hub`.

- [ ] **Step 1: Add `ActiveWorkspace` + helpers in `src/routes.rs`**

Replace the `AppState` definition (lines 18-25) and add the struct:

```rust
use std::sync::RwLock;

pub type SharedActive = Arc<RwLock<ActiveWorkspace>>;

pub struct ActiveWorkspace {
    pub id: String,
    pub folders: Vec<Arc<Workspace>>,
    pub sessions: Arc<SessionStore>,
}

impl ActiveWorkspace {
    /// First folder — the default cwd / single-folder convenience.
    pub fn primary(&self) -> Arc<Workspace> {
        self.folders[0].clone()
    }

    /// Folder whose canonical root matches `root` (as returned by root_display()).
    pub fn folder(&self, root: &str) -> Option<Arc<Workspace>> {
        self.folders.iter().find(|w| w.root_display() == root).cloned()
    }

    /// Validate a terminal cwd against every folder; first that accepts wins.
    pub fn resolve_dir_any(&self, path: &str) -> Result<PathBuf, WorkspaceError> {
        let mut last = WorkspaceError::NotFound;
        for w in &self.folders {
            match w.resolve_dir(path) {
                Ok(p) => return Ok(p),
                Err(e) => last = e,
            }
        }
        Err(last)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub active: SharedActive,
    pub hub: SharedHub,
}
```

Add `use std::path::PathBuf;` if not present.

- [ ] **Step 2: Update handlers to read from `active`**

In `src/routes.rs`, replace the bodies that referenced `state.workspace` / `state.sessions`:

```rust
async fn get_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let active = state.active.read().unwrap();
    let snap = active.sessions.get();
    Json(json!({
        "workspace": active.primary().root_display(),
        "terminals": snap.terminals,
        "widgets": snap.widgets,
        "edges": snap.edges,
        "widgetEdges": snap.widget_edges,
        "view": snap.view,
    }))
}

async fn put_sessions(
    State(state): State<AppState>,
    Json(body): Json<SessionSnapshot>,
) -> Result<StatusCode, ApiError> {
    let sessions = state.active.read().unwrap().sessions.clone();
    let prev: std::collections::HashSet<String> =
        sessions.get().terminals.into_iter().map(|t| t.name).collect();
    let next: std::collections::HashSet<String> =
        body.terminals.iter().map(|t| t.name.clone()).collect();
    for removed in prev.difference(&next) {
        crate::pty::kill_tmux_session(removed).await;
    }
    sessions
        .save(body)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "io error"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_files(State(state): State<AppState>) -> Response {
    let ws = state.active.read().unwrap().primary();
    Json(json!({ "files": ws.list_files() })).into_response()
}

async fn get_file(
    State(state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<crate::workspace::FileContent>, ApiError> {
    let ws = state.active.read().unwrap().primary();
    Ok(Json(ws.read_file(&q.path)?))
}
```

(`get_state`, `post_msg`, `post_reply`, `post_note`, `post_subagent` are unchanged — they only touch `state.hub`.)

- [ ] **Step 3: Update `pty_upgrade` + `handle_pty_socket`**

In `src/routes.rs`, `pty_upgrade` must hand the PTY the active folders so cwd validation spans all of them. Change it to pass a clone of the folder list:

```rust
async fn pty_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        let hub = state.hub.clone();
        let folders = state.active.read().unwrap().folders.clone();
        async move {
            handle_pty_socket(hub, folders, socket).await;
        }
    })
}
```

In `src/pty.rs`, change the signature (line 173) and the cwd check (line 192):

```rust
pub async fn handle_pty_socket(hub: SharedHub, folders: Vec<Arc<crate::workspace::Workspace>>, socket: WebSocket) {
    // ...unchanged until the cwd resolution...
    let cwd = match folders.iter().find_map(|w| w.resolve_dir(&spawn.cwd).ok()) {
        Some(p) => p,
        None => {
            send_error(&mut ws_tx, "invalid cwd (must be inside a workspace folder)").await;
            return;
        }
    };
    // ...rest unchanged...
}
```

Update imports in `src/pty.rs`: replace `use crate::routes::SharedWorkspace;` usage with `use std::sync::Arc;` (if not already imported) and reference `crate::workspace::Workspace`.

- [ ] **Step 4: Update `app_router`, `api_router`, and `main.rs`**

`src/routes.rs` bottom:

```rust
pub fn app_router(active: SharedActive, hub: SharedHub) -> Router {
    let state = AppState { active, hub };
    Router::new()
        .route("/state", get(get_state))
        .route("/msg", post(post_msg))
        .route("/reply", post(post_reply))
        .route("/note", post(post_note))
        .route("/subagents", post(post_subagent))
        .route("/sessions", get(get_sessions).put(put_sessions))
        .route("/files", get(get_files))
        .route("/file", get(get_file))
        .route("/ws", get(ws_upgrade))
        .route("/ws/pty", get(pty_upgrade))
        .with_state(state)
}

/// Test/helper constructor: one workspace folder, sessions under its root.
pub fn api_router(ws: Arc<Workspace>) -> Router {
    let sessions = Arc::new(SessionStore::new(ws.root()));
    let active = Arc::new(RwLock::new(ActiveWorkspace {
        id: "ws-01".into(),
        folders: vec![ws],
        sessions,
    }));
    app_router(active, Arc::new(Hub::new()))
}
```

`src/main.rs` (replace lines 18-25):

```rust
    let ws = Arc::new(Workspace::new(&workspace_root).expect("workspace root must exist"));
    let hub = Arc::new(Hub::new());
    let sessions = Arc::new(SessionStore::new(ws.root()));
    let active = Arc::new(std::sync::RwLock::new(agenthub::routes::ActiveWorkspace {
        id: "ws-01".into(),
        folders: vec![ws.clone()],
        sessions,
    }));

    let index = format!("{ui_dir}/index.html");
    let static_service = ServeDir::new(&ui_dir).fallback(ServeFile::new(index));

    let app = app_router(active, hub).fallback_service(static_service);
```

Update `main.rs` `println!` that used `ws.root_display()` — keep it (still valid, `ws` is in scope).

- [ ] **Step 5: Run the full Rust test suite**

Run: `cargo test`
Expected: PASS — existing `tests/api.rs` (`files_endpoint_lists_files`, `file_endpoint_returns_content`, `traversal_is_forbidden`) and all `workspace` unit tests still green. Fix compile errors (e.g. lingering `SharedWorkspace` references) until green.

- [ ] **Step 6: Commit**

```bash
git add src/routes.rs src/main.rs src/pty.rs
git commit -m "refactor(routes): introduce ActiveWorkspace state with folder vec"
```

---

### Task A3: Reshape `/files` (grouped) and `/file` (root+path)

**Files:**
- Modify: `src/routes.rs` (`get_files`, `get_file`, add `FileQuery.root`)
- Modify: `tests/api.rs` (update to new request/response shape)

**Interfaces:**
- Produces:
  - `GET /files` → `{ "folders": [ { "name": String, "root": String, "files": [String] } ] }`
  - `GET /file?root=<abs>&path=<rel>` → `FileContent` (`403` if `root` not an active folder)
- Consumes: `ActiveWorkspace::folder`, `Workspace::list_files`, `Workspace::read_file`, `Workspace::root_display`.

- [ ] **Step 1: Update the integration tests to the new shape**

Replace the three tests in `tests/api.rs`. The helper must expose the root so the test can pass `?root=`:

```rust
fn ws() -> Arc<Workspace> {
    let dir = std::env::temp_dir().join(format!("agenthub-it-{}", std::process::id()));
    fs::create_dir_all(dir.join("docs")).unwrap();
    fs::write(dir.join("docs/a.md"), "# hello").unwrap();
    Arc::new(Workspace::new(&dir).unwrap())
}

#[tokio::test]
async fn files_endpoint_groups_by_folder() {
    let w = ws();
    let root = w.root_display();
    let app = api_router(w);
    let resp = app
        .oneshot(Request::builder().uri("/files").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = body_string(resp).await;
    assert!(text.contains("\"folders\""));
    assert!(text.contains("docs/a.md"));
    assert!(text.contains(&root));
}

#[tokio::test]
async fn file_endpoint_returns_content() {
    let w = ws();
    let root = w.root_display();
    let app = api_router(w);
    let uri = format!("/file?root={}&path=docs/a.md", urlencoding(&root));
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(body_string(resp).await.contains("# hello"));
}

#[tokio::test]
async fn unknown_root_is_forbidden() {
    let app = api_router(ws());
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/file?root=/nope&path=docs/a.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn traversal_is_forbidden() {
    let w = ws();
    let root = w.root_display();
    let app = api_router(w);
    let uri = format!("/file?root={}&path=../../etc/passwd", urlencoding(&root));
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert!(matches!(resp.status(), StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
}

// Minimal percent-encoder for the few chars in a temp path query value.
fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test api`
Expected: FAIL — `/files` lacks `"folders"`, `/file` needs `root`, and the forbidden-root test gets `404`/`200` instead of `403`.

- [ ] **Step 3: Implement the new handlers**

In `src/routes.rs`:

```rust
async fn get_files(State(state): State<AppState>) -> Response {
    let active = state.active.read().unwrap();
    let folders: Vec<serde_json::Value> = active
        .folders
        .iter()
        .map(|w| {
            let root = w.root_display();
            let name = std::path::Path::new(&root)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.clone());
            json!({ "name": name, "root": root, "files": w.list_files() })
        })
        .collect();
    Json(json!({ "folders": folders })).into_response()
}

#[derive(Deserialize)]
struct FileQuery {
    root: String,
    path: String,
}

async fn get_file(
    State(state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<crate::workspace::FileContent>, ApiError> {
    let ws = state
        .active
        .read()
        .unwrap()
        .folder(&q.root)
        .ok_or(ApiError(StatusCode::FORBIDDEN, "unknown folder"))?;
    Ok(Json(ws.read_file(&q.path)?))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --test api`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes.rs tests/api.rs
git commit -m "feat(routes): group /files by folder, address /file by root+path"
```

---

### Task A4: `PUT /file` save endpoint

**Files:**
- Modify: `src/routes.rs` (handler + route)
- Modify: `tests/api.rs` (add save test)

**Interfaces:**
- Produces: `PUT /file?root=<abs>&path=<rel>` body `{ "content": String }` → `204`; `403` unknown root; `413` too large; `415` non-UTF-8 target (n/a here); `404` missing.
- Consumes: `ActiveWorkspace::folder`, `Workspace::write_file`.

- [ ] **Step 1: Write the failing test**

Add to `tests/api.rs`:

```rust
#[tokio::test]
async fn put_file_saves_content() {
    let w = ws();
    let root = w.root_display();
    let app = api_router(w);
    let uri = format!("/file?root={}&path=docs/a.md", urlencoding(&root));
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(&uri)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"content":"# saved"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let get = app
        .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert!(body_string(get).await.contains("# saved"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test api put_file_saves_content`
Expected: FAIL — `405 Method Not Allowed` (no PUT route).

- [ ] **Step 3: Implement handler + route**

In `src/routes.rs` add:

```rust
#[derive(Deserialize)]
struct SaveBody {
    content: String,
}

async fn put_file(
    State(state): State<AppState>,
    Query(q): Query<FileQuery>,
    Json(body): Json<SaveBody>,
) -> Result<StatusCode, ApiError> {
    let ws = state
        .active
        .read()
        .unwrap()
        .folder(&q.root)
        .ok_or(ApiError(StatusCode::FORBIDDEN, "unknown folder"))?;
    ws.write_file(&q.path, &body.content)?;
    Ok(StatusCode::NO_CONTENT)
}
```

Change the route line to add PUT:

```rust
        .route("/file", get(get_file).put(put_file))
```

Ensure `put` is imported: `use axum::routing::{get, post, put};`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --test api`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes.rs tests/api.rs
git commit -m "feat(routes): add PUT /file to save edits to disk"
```

---

## Phase B — Frontend: CodeMirror editor

### Task B1: Update `api.ts` to the new file API

**Files:**
- Modify: `ui/src/api.ts`
- Test: `ui/src/api.test.ts`

**Interfaces:**
- Produces:
  - `interface FolderFiles { name: string; root: string; files: string[] }`
  - `getFolders(): Promise<FolderFiles[]>` (GET `/files` → `data.folders`)
  - `getFile(root: string, path: string): Promise<FileContent>`
  - `saveFile(root: string, path: string, content: string): Promise<void>` (PUT)
- Consumes: existing `FileContent`.

- [ ] **Step 1: Read the current test to match its style**

Run: `cat ui/src/api.test.ts` — mirror its fetch-mock pattern in the new tests.

- [ ] **Step 2: Write the failing tests**

Replace `ui/src/api.test.ts` body with mocks for the new shape:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getFolders, getFile, saveFile } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("getFolders unwraps data.folders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ folders: [{ name: "repo", root: "/r", files: ["a.ts"] }] }),
    })) as unknown as typeof fetch);
    const folders = await getFolders();
    expect(folders[0].root).toBe("/r");
    expect(folders[0].files).toEqual(["a.ts"]);
  });

  it("saveFile PUTs root+path with JSON body", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await saveFile("/r", "a.ts", "hi");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/file?root=%2Fr&path=a.ts");
    expect((opts as RequestInit).method).toBe("PUT");
    expect((opts as RequestInit).body).toBe(JSON.stringify({ content: "hi" }));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix ui test -- api.test`
Expected: FAIL — `getFolders`/`saveFile` not exported.

- [ ] **Step 4: Implement `api.ts`**

Replace `ui/src/api.ts` with:

```ts
export type FileKind = "markdown" | "code" | "text";

export interface FileContent {
  path: string;
  content: string;
  kind: FileKind;
  ext: string;
}

export interface FolderFiles {
  name: string;
  root: string;
  files: string[];
}

export async function getFolders(): Promise<FolderFiles[]> {
  const res = await fetch("/files");
  if (!res.ok) throw new Error(`/files ${res.status}`);
  const data = (await res.json()) as { folders: FolderFiles[] };
  return data.folders;
}

export async function getFile(root: string, path: string): Promise<FileContent> {
  const qs = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  const res = await fetch(`/file?${qs}`);
  if (!res.ok) throw new Error(`/file ${res.status}`);
  return (await res.json()) as FileContent;
}

export async function saveFile(root: string, path: string, content: string): Promise<void> {
  const qs = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;
  const res = await fetch(`/file?${qs}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`save /file ${res.status}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix ui test -- api.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api.ts ui/src/api.test.ts
git commit -m "feat(ui): folder-addressed file api (getFolders/getFile/saveFile)"
```

---

### Task B2: Install CodeMirror and build the `Editor` component

**Files:**
- Modify: `ui/package.json` (deps)
- Create: `ui/src/Editor.tsx`
- Delete: `ui/src/Viewer.tsx`, `ui/src/Viewer.test.tsx` (replaced)
- Test: `ui/src/Editor.test.tsx`

**Interfaces:**
- Consumes: `FileContent` (from `api.ts`), `saveFile`.
- Produces: `Editor` React component with props
  `{ file: { root: string; data: FileContent }; onClose: () => void }`.

- [ ] **Step 1: Add dependencies**

Run:

```bash
npm --prefix ui install @uiw/react-codemirror @uiw/codemirror-theme-dracula @uiw/codemirror-extensions-langs
```

Expected: `package.json` gains the three deps; `npm --prefix ui install` exits 0.

- [ ] **Step 2: Write the failing test**

Create `ui/src/Editor.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Editor } from "./Editor";
import * as api from "./api";

afterEach(() => vi.restoreAllMocks());

const file = {
  root: "/r",
  data: { path: "a.ts", content: "const x = 1", kind: "code" as const, ext: "ts" },
};

describe("Editor", () => {
  it("renders the file path and content", () => {
    render(<Editor file={file} onClose={() => {}} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText(/const x/)).toBeInTheDocument();
  });

  it("saves via saveFile on Ctrl+S and clears the dirty marker", async () => {
    const save = vi.spyOn(api, "saveFile").mockResolvedValue();
    render(<Editor file={file} onClose={() => {}} />);
    // simulate an edit so the buffer is dirty
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(save).toHaveBeenCalledWith("/r", "a.ts", expect.any(String));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix ui test -- Editor.test`
Expected: FAIL — `Editor` module not found.

- [ ] **Step 4: Implement `Editor.tsx`**

Create `ui/src/Editor.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { saveFile, type FileContent } from "./api";

// Map our file extension to a CodeMirror language pack name.
const LANG: Record<string, Parameters<typeof loadLanguage>[0]> = {
  rs: "rust", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", sh: "shell", yml: "yaml", yaml: "yaml", html: "html",
  toml: "toml", json: "json", css: "css", go: "go", c: "c", cpp: "cpp",
  h: "c", md: "markdown", markdown: "markdown",
};

type Props = {
  file: { root: string; data: FileContent };
  onClose: () => void;
};

export function Editor({ file, onClose }: Props) {
  const { root, data } = file;
  const [value, setValue] = useState(data.content);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Reset buffer when a different file is opened.
  useEffect(() => {
    setValue(data.content);
    setDirty(false);
    setError(null);
    setPreview(false);
  }, [root, data.path, data.content]);

  const extensions = useMemo(() => {
    const lang = LANG[data.ext];
    const ext = lang ? loadLanguage(lang) : null;
    return ext ? [ext] : [];
  }, [data.ext]);

  const save = useCallback(async () => {
    try {
      await saveFile(root, data.path, value);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }, [root, data.path, value]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const isMarkdown = data.kind === "markdown";

  return (
    <div className="editor">
      <div className="editor-header">
        <span className="editor-path" title={data.path}>
          {data.path}
          {dirty && <span className="editor-dirty" aria-label="unsaved"> ●</span>}
        </span>
        <div className="editor-actions">
          {isMarkdown && (
            <button type="button" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={!dirty}>
            Save
          </button>
          <button type="button" onClick={onClose} aria-label="Close editor">✕</button>
        </div>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <div className="editor-body">
        {isMarkdown && preview ? (
          <div className="viewer markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
          </div>
        ) : (
          <CodeMirror
            value={value}
            theme={dracula}
            extensions={extensions}
            onChange={(v) => {
              setValue(v);
              setDirty(true);
            }}
            basicSetup={{ lineNumbers: true, foldGutter: true, indentOnInput: true }}
            height="100%"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Remove the old viewer**

```bash
git rm ui/src/Viewer.tsx ui/src/Viewer.test.tsx
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix ui test -- Editor.test`
Expected: PASS (2 tests). If CodeMirror's contenteditable doesn't emit `onChange` under jsdom for the keydown test, keep the assertion to `save` being called with `("/r","a.ts", ...)` (the Ctrl+S handler fires regardless of dirty state).

- [ ] **Step 7: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/src/Editor.tsx ui/src/Editor.test.tsx
git commit -m "feat(ui): CodeMirror editor with Dracula theme and save"
```

---

### Task B3: Wire the editor into `App.tsx`

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/App.css` (editor styles)

**Interfaces:**
- Consumes: `getFolders`, `getFile`, `Editor`, `AgentCanvas` prop `onOpenFile(root, path)`.
- Produces: open-file state `{ root: string; data: FileContent } | null`.

- [ ] **Step 1: Update `App.tsx`**

Replace `ui/src/App.tsx` with:

```tsx
import { useState } from "react";
import { getFile, type FileContent } from "./api";
import { AgentCanvas } from "./AgentCanvas";
import { Editor } from "./Editor";

export function App() {
  const [open, setOpen] = useState<{ root: string; data: FileContent } | null>(null);

  async function openFile(root: string, path: string) {
    try {
      setOpen({ root, data: await getFile(root, path) });
    } catch {
      // ignore — surfaced by the tree/editor layer later
    }
  }

  return (
    <div className="layout">
      <AgentCanvas onOpenFile={openFile} />
      {open && (
        <div className="file-drawer">
          <Editor file={open} onClose={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}
```

(Note: `AgentCanvas` no longer takes a `files` prop — it fetches folders itself in Task C3. `onOpenFile` signature becomes `(root, path) => void`.)

- [ ] **Step 2: Add editor styles**

Append to `ui/src/App.css`:

```css
.editor { display: flex; flex-direction: column; height: 100%; background: #282a36; color: #f8f8f2; }
.editor-header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid #44475a; font: 12px/1.4 ui-monospace, monospace; }
.editor-path { color: #bd93f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-dirty { color: #ffb86c; }
.editor-actions { display: flex; gap: 6px; }
.editor-actions button { background: #44475a; color: #f8f8f2; border: 0; border-radius: 4px;
  padding: 2px 8px; cursor: pointer; font-size: 12px; }
.editor-actions button:disabled { opacity: 0.4; cursor: default; }
.editor-error { background: #ff5555; color: #fff; padding: 4px 10px; font-size: 12px; }
.editor-body { flex: 1; overflow: auto; }
.editor-body .cm-editor { height: 100%; }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm --prefix ui run build`
Expected: `tsc` passes (no type errors) and `vite build` succeeds. If `AgentCanvas` props mismatch, that is resolved in Phase C; for now stub the `files` prop removal by leaving Task C3 to follow immediately. To keep this task self-contained, run `npm --prefix ui test` instead and defer the full build to the end of Task C3.

Run: `npm --prefix ui test`
Expected: all current tests PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/App.tsx ui/src/App.css
git commit -m "feat(ui): mount CodeMirror editor in the file drawer"
```

---

## Phase C — Frontend: multi-root collapsible file tree

### Task C1: Multi-root tree builder

**Files:**
- Modify: `ui/src/tree.ts`
- Test: `ui/src/tree.test.ts`

**Interfaces:**
- Consumes: `FolderFiles` (`{ name, root, files }`).
- Produces:
  - existing `TreeNode { name, path, children }` (unchanged)
  - `interface FolderTree { name: string; root: string; nodes: TreeNode[] }`
  - `buildFolderTrees(folders: FolderFiles[]): FolderTree[]`
  - keep `buildTree(paths: string[]): TreeNode[]` (used internally).

- [ ] **Step 1: Write the failing test**

Add to `ui/src/tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFolderTrees } from "./tree";

describe("buildFolderTrees", () => {
  it("builds one tree per folder, nesting dirs", () => {
    const trees = buildFolderTrees([
      { name: "repo", root: "/r", files: ["src/a.ts", "README.md"] },
    ]);
    expect(trees).toHaveLength(1);
    expect(trees[0].root).toBe("/r");
    const names = trees[0].nodes.map((n) => n.name);
    expect(names).toContain("src");   // directory
    expect(names).toContain("README.md"); // file
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui test -- tree.test`
Expected: FAIL — `buildFolderTrees` not exported.

- [ ] **Step 3: Implement**

Add to `ui/src/tree.ts` (keep existing `buildTree`/`TreeNode`):

```ts
import type { FolderFiles } from "./api";

export interface FolderTree {
  name: string;
  root: string;
  nodes: TreeNode[];
}

export function buildFolderTrees(folders: FolderFiles[]): FolderTree[] {
  return folders.map((f) => ({
    name: f.name,
    root: f.root,
    nodes: buildTree(f.files),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui test -- tree.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/tree.ts ui/src/tree.test.ts
git commit -m "feat(ui): multi-root tree builder"
```

---

### Task C2: Collapsible multi-root `FileTree`

**Files:**
- Modify: `ui/src/FileTree.tsx`
- Modify: `ui/src/FileTree.test.tsx`
- Modify: `ui/src/App.css` (tree styles)

**Interfaces:**
- Consumes: `FolderTree`, `TreeNode`.
- Produces: `FileTree` with props `{ folders: FolderTree[]; onSelect: (root: string, path: string) => void }`. Directories collapse/expand per node; folders start collapsed.

- [ ] **Step 1: Write the failing test**

Replace `ui/src/FileTree.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";
import { buildFolderTrees } from "./tree";

describe("FileTree", () => {
  const folders = buildFolderTrees([
    { name: "repo", root: "/r", files: ["src/a.ts"] },
  ]);

  it("hides nested files until the folder and dir are expanded", () => {
    render(<FileTree folders={folders} onSelect={() => {}} />);
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("repo"));     // expand folder root
    fireEvent.click(screen.getByText("src"));      // expand dir
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("calls onSelect with (root, path) when a file is clicked", () => {
    const onSelect = vi.fn();
    render(<FileTree folders={folders} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("repo"));
    fireEvent.click(screen.getByText("src"));
    fireEvent.click(screen.getByText("a.ts"));
    expect(onSelect).toHaveBeenCalledWith("/r", "src/a.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui test -- FileTree.test`
Expected: FAIL — `FileTree` still takes `files: string[]`.

- [ ] **Step 3: Implement**

Replace `ui/src/FileTree.tsx`:

```tsx
import { useState } from "react";
import type { TreeNode, FolderTree } from "./tree";

type SelectFn = (root: string, path: string) => void;

function Node({ node, root, onSelect }: { node: TreeNode; root: string; onSelect: SelectFn }) {
  const [open, setOpen] = useState(false);
  if (node.children === null) {
    return (
      <li>
        <button className="file" onClick={() => onSelect(root, node.path)}>
          <span className="tree-icon">📄</span>
          {node.name}
        </button>
      </li>
    );
  }
  return (
    <li>
      <button className="dir" onClick={() => setOpen((o) => !o)}>
        <span className="tree-chevron">{open ? "▾" : "▸"}</span>
        <span className="tree-icon">📁</span>
        {node.name}
      </button>
      {open && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.path} node={c} root={root} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Folder({ folder, onSelect }: { folder: FolderTree; onSelect: SelectFn }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="tree-folder">
      <button className="dir tree-root" onClick={() => setOpen((o) => !o)} title={folder.root}>
        <span className="tree-chevron">{open ? "▾" : "▸"}</span>
        <span className="tree-icon">🗂️</span>
        {folder.name}
      </button>
      {open && (
        <ul>
          {folder.nodes.map((n) => (
            <Node key={n.path} node={n} root={folder.root} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ folders, onSelect }: { folders: FolderTree[]; onSelect: SelectFn }) {
  return (
    <ul className="tree">
      {folders.map((f) => (
        <Folder key={f.root} folder={f} onSelect={onSelect} />
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Add indentation/icon styles**

Append to `ui/src/App.css`:

```css
.tree ul { list-style: none; margin: 0; padding-left: 14px; }
.tree .dir, .tree .file { display: flex; align-items: center; gap: 4px; width: 100%;
  background: none; border: 0; padding: 2px 4px; text-align: left; cursor: pointer;
  color: inherit; font-size: 12px; border-radius: 4px; }
.tree .dir:hover, .tree .file:hover { background: rgba(255,255,255,0.06); }
.tree-chevron { width: 10px; display: inline-block; opacity: 0.7; }
.tree-icon { width: 14px; display: inline-block; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix ui test -- FileTree.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add ui/src/FileTree.tsx ui/src/FileTree.test.tsx ui/src/App.css
git commit -m "feat(ui): collapsible multi-root file tree"
```

---

### Task C3: Feed folders through the sidebar and canvas

**Files:**
- Modify: `ui/src/WorkspaceSidebar.tsx` (props: `folders: FolderTree[]`, `onOpenFile: (root, path) => void`)
- Modify: `ui/src/AgentCanvas.tsx` (fetch folders, drop `files` prop, pass `onOpenFile(root, path)`)

**Interfaces:**
- Consumes: `getFolders`, `buildFolderTrees`, `FileTree`.
- Produces: `AgentCanvas` prop `onOpenFile: (root: string, path: string) => void`.

- [ ] **Step 1: Update `WorkspaceSidebar` Files section**

In `ui/src/WorkspaceSidebar.tsx`:
- Change the import: `import { FileTree } from "./FileTree";` (unchanged) and add `import type { FolderTree } from "./tree";`.
- Change `Props`: replace `files: string[];` with `folders: FolderTree[];` and `onOpenFile: (path: string) => void;` with `onOpenFile: (root: string, path: string) => void;`.
- Replace the Files section render (lines ~147-163) with:

```tsx
      {folders.length > 0 && (
        <div className="ws-section ws-files-section">
          <button
            type="button"
            className="ws-section-title ws-files-toggle"
            onClick={() => setFilesOpen((o) => !o)}
          >
            <span>Files</span>
            <span className="ws-files-chevron">{filesOpen ? "▾" : "▸"}</span>
          </button>
          {filesOpen && (
            <div className="ws-file-tree">
              <FileTree folders={folders} onSelect={onOpenFile} />
            </div>
          )}
        </div>
      )}
```

Update the destructured props (`files` → `folders`).

- [ ] **Step 2: Update `AgentCanvas` to fetch folders**

In `ui/src/AgentCanvas.tsx`:
- Change the component prop type from `{ files: string[]; onOpenFile: (path: string) => void }` to `{ onOpenFile: (root: string, path: string) => void }`.
- Add state + fetch:

```tsx
import { getFolders } from "./api";
import { buildFolderTrees, type FolderTree } from "./tree";
// ...
  const [folders, setFolders] = useState<FolderTree[]>([]);
  useEffect(() => {
    getFolders().then((f) => setFolders(buildFolderTrees(f))).catch(() => setFolders([]));
  }, []);
```

- Update the `onOpenFile` handler currently wired (`onOpenFile`) so it forwards `(root, path)`.
- Pass `folders={folders}` and `onOpenFile={onOpenFile}` to `<WorkspaceSidebar>` (replace the old `files={files}`).

- [ ] **Step 3: Build to verify the whole frontend compiles**

Run: `npm --prefix ui run build`
Expected: `tsc` + `vite build` succeed with no type errors.

- [ ] **Step 4: Run the full frontend test suite**

Run: `npm --prefix ui test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/WorkspaceSidebar.tsx ui/src/AgentCanvas.tsx
git commit -m "feat(ui): wire multi-root folders through sidebar and canvas"
```

---

### Task C4: Manual end-to-end smoke

**Files:** none (verification only).

- [ ] **Step 1: Build the UI and run the server**

```bash
npm --prefix ui run build
AGENTHUB_WORKSPACE="$PWD" cargo run
```

- [ ] **Step 2: Verify in the browser at http://127.0.0.1:3000**

Confirm, observing actual behavior:
- The left "Files" section shows the workspace folder as a collapsible root; expanding drills into directories; files are hidden until expanded.
- Clicking a code file opens the right drawer with a **Dracula-themed** CodeMirror editor (readable, line numbers, indentation) — not black-on-black.
- Editing then `Ctrl+S` saves; reopening the file shows the saved content; the dirty dot clears on save.
- A `.md` file shows an Edit/Preview toggle.

- [ ] **Step 3: Commit (if any doc/notes changed)** — otherwise skip.

---

## Self-Review (filled in)

**Spec coverage (Plan 1 scope):**
- Editor editable + Dracula + line numbers + indentation + save → Tasks A1, A4, B2, B3. ✅
- `/file` by `(root, path)`, `PUT /file` → A3, A4. ✅
- `/files` grouped by folder → A3. ✅
- Multi-root collapsible tree → C1, C2, C3. ✅
- Markdown edit/preview toggle → B2. ✅
- Path-traversal + size guards on write → A1 (tests), A4. ✅
- Out of Plan 1 (deferred to Plan 2): registry, `/browse`, picker, runtime switch, auto-connect, canvas migration. Tracked in Plan 2.

**Placeholder scan:** No TBD/TODO; every code step has full code; every test step has assertions; commands have expected output. ✅

**Type consistency:** `ActiveWorkspace`/`SharedActive`/`folder()`/`primary()` consistent across A2–A4. `FolderFiles`/`getFolders`/`getFile(root,path)`/`saveFile` consistent across B1–C3. `FolderTree`/`buildFolderTrees` consistent C1–C3. `onOpenFile(root, path)` consistent App→AgentCanvas→Sidebar→FileTree. ✅
