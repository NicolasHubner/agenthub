# Multi-root Workspaces + Directory Picker — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1 (`2026-06-18-ide-editor-and-multiroot-files.md`) is merged — this plan assumes `ActiveWorkspace { id, folders: Vec<Arc<Workspace>>, sessions }`, `SharedActive = Arc<RwLock<ActiveWorkspace>>`, `app_router(active, hub)`, folder-addressed `/files`/`/file`, and the multi-root `FileTree`.

**Goal:** Make a *workspace* a named container of one-or-more folders, persisted in a global registry, switchable at runtime; add a filesystem directory picker to create workspaces and connect folders; auto-connect a folder when a terminal spawns in a new directory.

**Architecture:** A new `registry.rs` persists workspaces to `~/.agenthub/workspaces.json`. `AppState` gains the registry; switching active rebuilds the `ActiveWorkspace` (folders + a per-workspace `SessionStore` at `~/.agenthub/workspaces/<id>/sessions.json`) and swaps it under the write lock. The frontend replaces the header free-text Directory field with a workspace switcher + a `DirectoryPicker` modal.

**Tech Stack:** Rust (axum, tokio), React 18 + Vite + Vitest.

## Global Constraints

- Registry persists to `~/.agenthub/workspaces.json`; per-workspace canvas to `~/.agenthub/workspaces/<id>/sessions.json`. Home resolved via `$HOME` then `$USERPROFILE`.
- Workspace ids are `ws-NN` (zero-padded, sequential). Default name `Workspace NN`.
- `GET /browse` exposes filesystem directory listings — acceptable because the server is bound to `127.0.0.1` only. It lists directories only and hides dotfiles.
- A folder reference in any `/file`/`/files` request must match a folder of the **active** workspace, else `403` (guard from Plan 1).
- Terminal cwd must resolve inside an active folder; auto-connect adds the folder **before** spawn so the guard still holds.
- Run Rust tests with `cargo test`; frontend with `npm --prefix ui test`. Conventional Commits, one commit per task minimum.

---

## Phase D — Directory browse + picker

### Task D1: `GET /browse` endpoint + home-dir helper

**Files:**
- Create: `src/registry.rs` (start the module with path helpers only; registry struct lands in Task E1)
- Modify: `src/lib.rs` (add `pub mod registry;`)
- Modify: `src/routes.rs` (add `get_browse` + route)
- Modify: `tests/api.rs` (browse test)

**Interfaces:**
- Produces:
  - `pub fn registry::home_dir() -> PathBuf`
  - `pub fn registry::agenthub_home() -> PathBuf` (`home_dir()/.agenthub`)
  - `pub fn registry::workspace_state_dir(id: &str) -> PathBuf` (`agenthub_home()/workspaces/<id>`)
  - `GET /browse?path=` → `{ "path": String, "parent": String|null, "entries": [{ "name": String, "dir": true }] }`; empty `path` → `home_dir()`.
- Consumes: `ApiError`.

- [ ] **Step 1: Create `src/registry.rs` with path helpers**

```rust
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
```

Add to `src/lib.rs`: `pub mod registry;`

- [ ] **Step 2: Write the failing browse test**

Add to `tests/api.rs`:

```rust
#[tokio::test]
async fn browse_lists_subdirs_and_parent() {
    let base = std::env::temp_dir().join(format!("agenthub-browse-{}", std::process::id()));
    fs::create_dir_all(base.join("sub")).unwrap();
    fs::write(base.join("file.txt"), "x").unwrap();
    let app = api_router(ws());
    let uri = format!("/browse?path={}", urlencoding(&base.canonicalize().unwrap().display().to_string()));
    let resp = app.oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = body_string(resp).await;
    assert!(text.contains("\"sub\""));      // directory listed
    assert!(!text.contains("file.txt"));    // files excluded
    assert!(text.contains("\"parent\""));
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --test api browse_lists_subdirs_and_parent`
Expected: FAIL — `404` (no `/browse` route).

- [ ] **Step 4: Implement `get_browse`**

In `src/routes.rs`:

```rust
#[derive(Deserialize)]
struct BrowseQuery {
    #[serde(default)]
    path: String,
}

async fn get_browse(Query(q): Query<BrowseQuery>) -> Result<Json<serde_json::Value>, ApiError> {
    let base = if q.path.is_empty() {
        crate::registry::home_dir()
    } else {
        std::path::PathBuf::from(&q.path)
    };
    let dir = base
        .canonicalize()
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such directory"))?;
    if !dir.is_dir() {
        return Err(ApiError(StatusCode::NOT_FOUND, "not a directory"));
    }
    let mut entries: Vec<serde_json::Value> = std::fs::read_dir(&dir)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "io error"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.')).then(|| json!({ "name": name, "dir": true }))
        })
        .collect();
    entries.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    let parent = dir.parent().map(|p| p.display().to_string());
    Ok(Json(json!({
        "path": dir.display().to_string(),
        "parent": parent,
        "entries": entries,
    })))
}
```

Add route in `app_router`: `.route("/browse", get(get_browse))`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --test api`
Expected: PASS (all prior + browse).

- [ ] **Step 6: Commit**

```bash
git add src/registry.rs src/lib.rs src/routes.rs tests/api.rs
git commit -m "feat(routes): add GET /browse for filesystem directory navigation"
```

---

### Task D2: `DirectoryPicker` modal

**Files:**
- Create: `ui/src/workspaces.ts` (start with the `browse` client; rest in Phase E)
- Create: `ui/src/DirectoryPicker.tsx`
- Test: `ui/src/DirectoryPicker.test.tsx`
- Modify: `ui/src/App.css` (modal styles)

**Interfaces:**
- Produces:
  - `interface BrowseResult { path: string; parent: string | null; entries: { name: string; dir: true }[] }`
  - `browse(path?: string): Promise<BrowseResult>`
  - `DirectoryPicker` component: props `{ title: string; onCancel: () => void; onConfirm: (dir: string) => void }`.

- [ ] **Step 1: Create the browse client**

`ui/src/workspaces.ts`:

```ts
export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: { name: string; dir: true }[];
}

export async function browse(path = ""): Promise<BrowseResult> {
  const res = await fetch(`/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`/browse ${res.status}`);
  return (await res.json()) as BrowseResult;
}
```

- [ ] **Step 2: Write the failing test**

`ui/src/DirectoryPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DirectoryPicker } from "./DirectoryPicker";
import * as ws from "./workspaces";

afterEach(() => vi.restoreAllMocks());

describe("DirectoryPicker", () => {
  it("lists entries and confirms the current path", async () => {
    vi.spyOn(ws, "browse").mockResolvedValue({
      path: "/home/me",
      parent: "/home",
      entries: [{ name: "projects", dir: true }],
    });
    const onConfirm = vi.fn();
    render(<DirectoryPicker title="New workspace" onCancel={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => screen.getByText("projects"));
    expect(screen.getByText("/home/me")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Select this folder/i));
    expect(onConfirm).toHaveBeenCalledWith("/home/me");
  });

  it("descends into a clicked directory", async () => {
    const spy = vi
      .spyOn(ws, "browse")
      .mockResolvedValueOnce({ path: "/home/me", parent: "/home", entries: [{ name: "projects", dir: true }] })
      .mockResolvedValueOnce({ path: "/home/me/projects", parent: "/home/me", entries: [] });
    render(<DirectoryPicker title="x" onCancel={() => {}} onConfirm={() => {}} />);
    await waitFor(() => screen.getByText("projects"));
    fireEvent.click(screen.getByText("projects"));
    await waitFor(() => expect(spy).toHaveBeencalledWith?.("/home/me/projects") ?? spy);
    await waitFor(() => screen.getByText("/home/me/projects"));
  });
});
```

(If your matcher set lacks `toHaveBeenCalledWith` chaining, simplify the second test's assertion to `await waitFor(() => screen.getByText("/home/me/projects"))`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --prefix ui test -- DirectoryPicker.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `DirectoryPicker.tsx`**

```tsx
import { useEffect, useState } from "react";
import { browse, type BrowseResult } from "./workspaces";

type Props = {
  title: string;
  onCancel: () => void;
  onConfirm: (dir: string) => void;
};

export function DirectoryPicker({ title, onCancel, onConfirm }: Props) {
  const [view, setView] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function go(path: string) {
    browse(path)
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch(() => setError("Cannot open this folder"));
  }

  useEffect(() => {
    go(""); // start at home
  }, []);

  return (
    <div className="picker-backdrop" onClick={onCancel}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>{title}</strong>
          <button type="button" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>
        <div className="picker-path">{view?.path ?? "…"}</div>
        <ul className="picker-list">
          {view?.parent != null && (
            <li>
              <button type="button" className="picker-up" onClick={() => go(view.parent!)}>
                <span className="tree-icon">⬆</span> ..
              </button>
            </li>
          )}
          {view?.entries.map((e) => (
            <li key={e.name}>
              <button type="button" onClick={() => go(`${view.path}/${e.name}`)}>
                <span className="tree-icon">📁</span> {e.name}
              </button>
            </li>
          ))}
        </ul>
        {error && <div className="picker-error">{error}</div>}
        <div className="picker-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="picker-confirm"
            disabled={!view}
            onClick={() => view && onConfirm(view.path)}
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add modal styles**

Append to `ui/src/App.css`:

```css
.picker-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000; }
.picker { width: 460px; max-height: 70vh; display: flex; flex-direction: column;
  background: #21222c; color: #f8f8f2; border: 1px solid #44475a; border-radius: 8px; overflow: hidden; }
.picker-head { display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-bottom: 1px solid #44475a; }
.picker-head button { background: none; border: 0; color: #f8f8f2; cursor: pointer; }
.picker-path { padding: 6px 12px; font: 12px ui-monospace, monospace; color: #8be9fd;
  border-bottom: 1px solid #44475a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-list { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1; }
.picker-list button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
  background: none; border: 0; color: inherit; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
.picker-list button:hover { background: rgba(255,255,255,0.07); }
.picker-error { color: #ff5555; padding: 4px 12px; font-size: 12px; }
.picker-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 12px;
  border-top: 1px solid #44475a; }
.picker-actions button { background: #44475a; color: #f8f8f2; border: 0; border-radius: 4px;
  padding: 4px 12px; cursor: pointer; }
.picker-confirm { background: #bd93f9 !important; color: #21222c !important; font-weight: 600; }
.picker-confirm:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --prefix ui test -- DirectoryPicker.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/workspaces.ts ui/src/DirectoryPicker.tsx ui/src/DirectoryPicker.test.tsx ui/src/App.css
git commit -m "feat(ui): DirectoryPicker modal backed by /browse"
```

---

## Phase E — Workspace registry + runtime switching

### Task E1: `Registry` struct + persistence + seed

**Files:**
- Modify: `src/registry.rs` (add the struct + impl + tests)

**Interfaces:**
- Produces:
  - `pub struct WorkspaceEntry { pub id: String, pub name: String, pub folders: Vec<String> }`
  - `pub struct Registry` with:
    - `pub fn open(path: PathBuf) -> Self`
    - `pub fn default_path() -> PathBuf` (`agenthub_home()/workspaces.json`)
    - `pub fn seed_if_empty(&self, seed_dir: &Path)` (creates `ws-01` "Workspace 01" with canonicalized `seed_dir`)
    - `pub fn snapshot(&self) -> (String /*active id*/, Vec<WorkspaceEntry>)`
    - `pub fn active_entry(&self) -> Option<WorkspaceEntry>`
    - `pub fn entry(&self, id: &str) -> Option<WorkspaceEntry>`
    - `pub fn create(&self, name: Option<String>, folder: String) -> WorkspaceEntry`
    - `pub fn set_active(&self, id: &str) -> bool`
    - `pub fn remove(&self, id: &str)`
    - `pub fn rename(&self, id: &str, name: String)`
    - `pub fn add_folder(&self, id: &str, dir: String)`
    - `pub fn remove_folder(&self, id: &str, dir: &str)`
- Consumes: `home_dir`, `agenthub_home`.

- [ ] **Step 1: Write the failing tests**

Add to `src/registry.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib registry`
Expected: FAIL — `Registry`/`WorkspaceEntry` undefined.

- [ ] **Step 3: Implement the struct**

Add to `src/registry.rs` (above `#[cfg(test)]`):

```rust
use std::path::Path;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

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
        let mut data = self.data.lock().unwrap();
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
        let data = self.data.lock().unwrap();
        (data.active.clone(), data.workspaces.clone())
    }

    pub fn entry(&self, id: &str) -> Option<WorkspaceEntry> {
        self.data.lock().unwrap().workspaces.iter().find(|w| w.id == id).cloned()
    }

    pub fn active_entry(&self) -> Option<WorkspaceEntry> {
        let data = self.data.lock().unwrap();
        data.workspaces.iter().find(|w| w.id == data.active).cloned()
    }

    pub fn create(&self, name: Option<String>, folder: String) -> WorkspaceEntry {
        let mut data = self.data.lock().unwrap();
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
        let mut data = self.data.lock().unwrap();
        if data.workspaces.iter().any(|w| w.id == id) {
            data.active = id.to_string();
            self.persist(&data);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, id: &str) {
        let mut data = self.data.lock().unwrap();
        data.workspaces.retain(|w| w.id != id);
        if data.active == id {
            data.active = data.workspaces.first().map(|w| w.id.clone()).unwrap_or_default();
        }
        self.persist(&data);
    }

    pub fn rename(&self, id: &str, name: String) {
        let mut data = self.data.lock().unwrap();
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            w.name = name;
        }
        self.persist(&data);
    }

    pub fn add_folder(&self, id: &str, dir: String) {
        let mut data = self.data.lock().unwrap();
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            if !w.folders.contains(&dir) {
                w.folders.push(dir);
            }
        }
        self.persist(&data);
    }

    pub fn remove_folder(&self, id: &str, dir: &str) {
        let mut data = self.data.lock().unwrap();
        if let Some(w) = data.workspaces.iter_mut().find(|w| w.id == id) {
            w.folders.retain(|f| f != dir);
        }
        self.persist(&data);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib registry`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/registry.rs
git commit -m "feat(registry): persistent multi-folder workspace registry"
```

---

### Task E2: Per-workspace `SessionStore` location + legacy migration

**Files:**
- Modify: `src/sessions.rs` (add `new_in` constructor)
- Test: `src/sessions.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `pub fn SessionStore::new_in(state_dir: &Path) -> Self` (reads/writes `state_dir/sessions.json`).
- Keep existing `new(workspace_root)` for back-compat / legacy read.

- [ ] **Step 1: Write the failing test**

Add a `tests` module to `src/sessions.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib new_in_uses_dir_directly`
Expected: FAIL — `no function new_in`.

- [ ] **Step 3: Implement `new_in`**

In `src/sessions.rs`, refactor `new` to delegate:

```rust
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
        Self { path, data: Mutex::new(data) }
    }
    // get() and save() unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib`
Expected: PASS (sessions + workspace + registry).

- [ ] **Step 5: Commit**

```bash
git add src/sessions.rs
git commit -m "feat(sessions): add new_in for per-workspace state directory"
```

---

### Task E3: Wire the registry into `AppState`; build/switch active

**Files:**
- Modify: `src/routes.rs` (AppState gains `registry`; add a `build_active` helper; `app_router` signature)
- Modify: `src/main.rs` (construct registry, seed, build initial active)
- Modify: `tests/api.rs` (`api_router` builds a registry too)

**Interfaces:**
- Produces:
  - `AppState { active: SharedActive, hub: SharedHub, registry: Arc<Registry> }`
  - `pub fn build_active(entry: &WorkspaceEntry) -> ActiveWorkspace` (folders from `entry.folders` that exist; sessions at `workspace_state_dir(&entry.id)`; migrates legacy `<folder0>/.agenthub/sessions.json` once)
  - `pub fn app_router(active: SharedActive, hub: SharedHub, registry: Arc<Registry>) -> Router`
- Consumes: `Registry`, `registry::workspace_state_dir`, `SessionStore::new_in`.

- [ ] **Step 1: Add `build_active` + update `AppState`/`app_router`**

In `src/routes.rs`:

```rust
use crate::registry::{Registry, WorkspaceEntry, workspace_state_dir};

#[derive(Clone)]
pub struct AppState {
    pub active: SharedActive,
    pub hub: SharedHub,
    pub registry: Arc<Registry>,
}

/// Build the in-memory active workspace from a registry entry.
pub fn build_active(entry: &WorkspaceEntry) -> ActiveWorkspace {
    let folders: Vec<Arc<Workspace>> = entry
        .folders
        .iter()
        .filter_map(|dir| Workspace::new(dir).ok().map(Arc::new))
        .collect();

    let state_dir = workspace_state_dir(&entry.id);
    let _ = std::fs::create_dir_all(&state_dir);
    // One-time migration: if no global sessions yet, import the legacy
    // per-directory file from the first folder.
    let global = state_dir.join("sessions.json");
    if !global.exists() {
        if let Some(first) = entry.folders.first() {
            let legacy = std::path::Path::new(first).join(".agenthub").join("sessions.json");
            if legacy.exists() {
                let _ = std::fs::copy(&legacy, &global);
            }
        }
    }
    let sessions = Arc::new(SessionStore::new_in(&state_dir));
    ActiveWorkspace { id: entry.id.clone(), folders, sessions }
}

pub fn app_router(active: SharedActive, hub: SharedHub, registry: Arc<Registry>) -> Router {
    let state = AppState { active, hub, registry };
    Router::new()
        .route("/state", get(get_state))
        .route("/msg", post(post_msg))
        .route("/reply", post(post_reply))
        .route("/note", post(post_note))
        .route("/subagents", post(post_subagent))
        .route("/sessions", get(get_sessions).put(put_sessions))
        .route("/files", get(get_files))
        .route("/file", get(get_file).put(put_file))
        .route("/browse", get(get_browse))
        .route("/ws", get(ws_upgrade))
        .route("/ws/pty", get(pty_upgrade))
        .with_state(state)
}
```

- [ ] **Step 2: Update `api_router` (test helper) and `main.rs`**

`src/routes.rs` `api_router`:

```rust
pub fn api_router(ws: Arc<Workspace>) -> Router {
    let root = ws.root_display();
    let sessions = Arc::new(SessionStore::new(ws.root()));
    let active = Arc::new(RwLock::new(ActiveWorkspace {
        id: "ws-01".into(),
        folders: vec![ws],
        sessions,
    }));
    let registry = Arc::new(Registry::open(
        std::env::temp_dir().join(format!("agenthub-reg-test-{}.json", std::process::id())),
    ));
    registry.seed_if_empty(std::path::Path::new(&root));
    app_router(active, Arc::new(Hub::new()), registry)
}
```

`src/main.rs` (replace the active-construction block):

```rust
    let hub = Arc::new(Hub::new());
    let registry = Arc::new(agenthub::registry::Registry::open(
        agenthub::registry::Registry::default_path(),
    ));
    registry.seed_if_empty(std::path::Path::new(&workspace_root));
    let entry = registry.active_entry().expect("seeded workspace exists");
    let active = Arc::new(std::sync::RwLock::new(agenthub::routes::build_active(&entry)));

    let index = format!("{ui_dir}/index.html");
    let static_service = ServeDir::new(&ui_dir).fallback(ServeFile::new(index));
    let app = app_router(active, hub, registry).fallback_service(static_service);
```

Remove the now-unused single-`Workspace`/`SessionStore` construction lines in `main.rs` (the `let ws = …; let sessions = …;` from Plan 1 Task A2) — `build_active` owns that now. Keep the `workspace_root`, `ui_dir`, `port` reads. Adjust the `println!` workspace line to `println!("agenthub: workspace {}", entry.name);`.

- [ ] **Step 3: Run the suite**

Run: `cargo test`
Expected: PASS — existing api + workspace + registry + sessions tests all green.

- [ ] **Step 4: Commit**

```bash
git add src/routes.rs src/main.rs tests/api.rs
git commit -m "feat(routes): registry-backed AppState with build_active"
```

---

### Task E4: Workspace CRUD + switch endpoints

**Files:**
- Modify: `src/routes.rs` (handlers + routes)
- Modify: `tests/api.rs` (workspaces tests)

**Interfaces:**
- Produces:
  - `GET /workspaces` → `{ "active": String, "workspaces": [WorkspaceEntry] }`
  - `POST /workspaces` `{ name?: String, folder: String }` → `WorkspaceEntry` (validates dir; switches active; rebuilds active state)
  - `POST /workspaces/active` `{ id: String }` → `204`/`404` (rebuilds active)
  - `DELETE /workspaces/:id` → `204` (if it was active, rebuild from the new active)
  - `PATCH /workspaces/:id` `{ name: String }` → `204`
  - `POST /workspaces/:id/folders` `{ dir: String }` → `204` (validates dir; if `:id` is active, hot-add the folder to live state)
  - `DELETE /workspaces/:id/folders` `{ dir: String }` → `204`
- Consumes: `Registry`, `build_active`, `Workspace::new`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/api.rs`:

```rust
#[tokio::test]
async fn workspaces_list_then_create_and_switch() {
    let app = api_router(ws());
    // list
    let list = app
        .clone()
        .oneshot(Request::builder().uri("/workspaces").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    assert!(body_string(list).await.contains("ws-01"));

    // create a second workspace pointing at a real dir
    let dir = std::env::temp_dir().join(format!("agenthub-ws2-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let body = format!(r#"{{"folder":"{}"}}"#, dir.canonicalize().unwrap().display());
    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/workspaces")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    assert!(body_string(created).await.contains("ws-02"));

    // switch back to ws-01
    let switched = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/workspaces/active")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"id":"ws-01"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(switched.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn switch_to_unknown_workspace_404() {
    let app = api_router(ws());
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/workspaces/active")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"id":"nope"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test api workspaces_list_then_create_and_switch switch_to_unknown_workspace_404`
Expected: FAIL — `404`/`405` (routes absent).

- [ ] **Step 3: Implement handlers + routes**

In `src/routes.rs`:

```rust
use axum::extract::Path as AxPath;

async fn get_workspaces(State(state): State<AppState>) -> Json<serde_json::Value> {
    let (active, list) = state.registry.snapshot();
    Json(json!({ "active": active, "workspaces": list }))
}

#[derive(Deserialize)]
struct CreateWsBody { #[serde(default)] name: Option<String>, folder: String }

async fn post_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWsBody>,
) -> Result<Json<WorkspaceEntry>, ApiError> {
    // validate the folder before recording it
    let ws = Workspace::new(&body.folder).map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such folder"))?;
    let entry = state.registry.create(body.name, ws.root_display());
    *state.active.write().unwrap() = build_active(&entry);
    Ok(Json(entry))
}

#[derive(Deserialize)]
struct ActiveBody { id: String }

async fn post_active(
    State(state): State<AppState>,
    Json(body): Json<ActiveBody>,
) -> Result<StatusCode, ApiError> {
    if !state.registry.set_active(&body.id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "unknown workspace"));
    }
    let entry = state.registry.entry(&body.id).expect("just set active");
    *state.active.write().unwrap() = build_active(&entry);
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_workspace(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
) -> StatusCode {
    let was_active = state.registry.snapshot().0 == id;
    state.registry.remove(&id);
    if was_active {
        if let Some(entry) = state.registry.active_entry() {
            *state.active.write().unwrap() = build_active(&entry);
        }
    }
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct RenameBody { name: String }

async fn patch_workspace(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<RenameBody>,
) -> StatusCode {
    state.registry.rename(&id, body.name);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct FolderBody { dir: String }

async fn post_folder(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<FolderBody>,
) -> Result<StatusCode, ApiError> {
    let ws = Workspace::new(&body.dir).map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such folder"))?;
    let canon = ws.root_display();
    state.registry.add_folder(&id, canon.clone());
    // hot-add to live state if this is the active workspace
    if state.registry.snapshot().0 == id {
        let mut active = state.active.write().unwrap();
        if active.folder(&canon).is_none() {
            active.folders.push(Arc::new(ws));
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_folder(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<FolderBody>,
) -> StatusCode {
    state.registry.remove_folder(&id, &body.dir);
    if state.registry.snapshot().0 == id {
        let mut active = state.active.write().unwrap();
        active.folders.retain(|w| w.root_display() != body.dir);
    }
    StatusCode::NO_CONTENT
}
```

Add routes in `app_router`:

```rust
        .route("/workspaces", get(get_workspaces).post(post_workspace))
        .route("/workspaces/active", post(post_active))
        .route("/workspaces/:id", axum::routing::delete(delete_workspace).patch(patch_workspace))
        .route("/workspaces/:id/folders", post(post_folder).delete(delete_folder))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --test api`
Expected: PASS.

- [ ] **Step 5: Update `get_sessions` to report the workspace name**

So the frontend shows the workspace name (not a folder path). In `get_sessions`, replace the `"workspace"` field:

```rust
async fn get_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let name = state
        .registry
        .active_entry()
        .map(|e| e.name)
        .unwrap_or_else(|| "Workspace".into());
    let active = state.active.read().unwrap();
    let snap = active.sessions.get();
    Json(json!({
        "workspace": name,
        "terminals": snap.terminals,
        "widgets": snap.widgets,
        "edges": snap.edges,
        "widgetEdges": snap.widget_edges,
        "view": snap.view,
    }))
}
```

- [ ] **Step 6: Run the full suite + commit**

Run: `cargo test`
Expected: PASS.

```bash
git add src/routes.rs tests/api.rs
git commit -m "feat(routes): workspace CRUD, runtime switch, hot folder add/remove"
```

---

### Task E5: Frontend workspace client + switcher UI

**Files:**
- Modify: `ui/src/workspaces.ts` (CRUD client)
- Modify: `ui/src/WorkspaceSidebar.tsx` (workspace list + actions)
- Modify: `ui/src/App.css` (switcher styles)
- Test: `ui/src/workspaces.test.ts`

**Interfaces:**
- Produces (in `workspaces.ts`):
  - `interface WorkspaceEntry { id: string; name: string; folders: string[] }`
  - `listWorkspaces(): Promise<{ active: string; workspaces: WorkspaceEntry[] }>`
  - `createWorkspace(folder: string, name?: string): Promise<WorkspaceEntry>`
  - `switchWorkspace(id: string): Promise<void>`
  - `connectFolder(id: string, dir: string): Promise<void>`
  - `removeWorkspace(id: string): Promise<void>`
  - `renameWorkspace(id: string, name: string): Promise<void>`
- Consumes: existing `browse`.

- [ ] **Step 1: Write the failing test**

`ui/src/workspaces.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { listWorkspaces, createWorkspace, switchWorkspace, connectFolder } from "./workspaces";

afterEach(() => vi.restoreAllMocks());

describe("workspaces client", () => {
  it("listWorkspaces returns active + list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ active: "ws-01", workspaces: [{ id: "ws-01", name: "Workspace 01", folders: ["/r"] }] }),
    })) as unknown as typeof fetch);
    const { active, workspaces } = await listWorkspaces();
    expect(active).toBe("ws-01");
    expect(workspaces[0].folders).toEqual(["/r"]);
  });

  it("createWorkspace POSTs folder + optional name", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "ws-02", name: "x", folders: ["/d"] }) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await createWorkspace("/d", "x");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/workspaces");
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({ folder: "/d", name: "x" });
  });

  it("connectFolder POSTs to the folders route", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await connectFolder("ws-01", "/d");
    expect(fetchMock.mock.calls[0][0]).toBe("/workspaces/ws-01/folders");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix ui test -- workspaces.test`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the client**

Append to `ui/src/workspaces.ts`:

```ts
export interface WorkspaceEntry {
  id: string;
  name: string;
  folders: string[];
}

export async function listWorkspaces(): Promise<{ active: string; workspaces: WorkspaceEntry[] }> {
  const res = await fetch("/workspaces");
  if (!res.ok) throw new Error(`/workspaces ${res.status}`);
  return res.json();
}

export async function createWorkspace(folder: string, name?: string): Promise<WorkspaceEntry> {
  const res = await fetch("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { folder, name } : { folder }),
  });
  if (!res.ok) throw new Error(`create workspace ${res.status}`);
  return res.json();
}

export async function switchWorkspace(id: string): Promise<void> {
  const res = await fetch("/workspaces/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`switch workspace ${res.status}`);
}

export async function connectFolder(id: string, dir: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });
  if (!res.ok) throw new Error(`connect folder ${res.status}`);
}

export async function removeWorkspace(id: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`remove workspace ${res.status}`);
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`rename workspace ${res.status}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix ui test -- workspaces.test`
Expected: PASS.

- [ ] **Step 5: Render the workspace list in `WorkspaceSidebar`**

In `ui/src/WorkspaceSidebar.tsx`, extend `Props`:

```tsx
import type { WorkspaceEntry } from "./workspaces";
// add to Props:
//   workspaces: WorkspaceEntry[];
//   activeId: string;
//   onSwitchWorkspace: (id: string) => void;
//   onNewWorkspace: () => void;
```

Replace the single `ws-active` block (lines ~52-61) with a list + new button:

```tsx
      <div className="ws-list">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`ws-active${w.id === activeId ? " current" : ""}`}
            onClick={() => onSwitchWorkspace(w.id)}
            title={w.folders.join("\n")}
          >
            <span className="ws-dot" />
            <div className="ws-active-info">
              <strong>{w.name}</strong>
              <span className="ws-cwd">{w.folders.length} folder{w.folders.length === 1 ? "" : "s"}</span>
            </div>
            {w.id === activeId && <span className="ws-count">{items.length}</span>}
          </button>
        ))}
        <button type="button" className="ws-new" onClick={onNewWorkspace}>+ New workspace</button>
      </div>
```

Add styles to `ui/src/App.css`:

```css
.ws-list { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.ws-active { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: none; border: 1px solid transparent; border-radius: 6px; padding: 6px 8px;
  cursor: pointer; color: inherit; }
.ws-active.current { background: rgba(189,147,249,0.12); border-color: #bd93f9; }
.ws-new { background: none; border: 1px dashed #44475a; border-radius: 6px; padding: 6px 8px;
  color: #8be9fd; cursor: pointer; font-size: 12px; }
```

- [ ] **Step 6: Build + commit**

Run: `npm --prefix ui run build` → PASS (wiring of the new props happens in Task E6; until then, pass placeholders if you build mid-task — but prefer doing E6 immediately so `tsc` is green at commit).

```bash
git add ui/src/workspaces.ts ui/src/workspaces.test.ts ui/src/WorkspaceSidebar.tsx ui/src/App.css
git commit -m "feat(ui): workspace client + sidebar switcher list"
```

---

### Task E6: Canvas wiring — switch, create, remove free-text Directory, auto-connect

**Files:**
- Modify: `ui/src/AgentCanvas.tsx`

**Interfaces:**
- Consumes: `listWorkspaces`, `switchWorkspace`, `createWorkspace`, `connectFolder`, `getFolders`, `buildFolderTrees`, `DirectoryPicker`.

- [ ] **Step 1: Add workspace state + load**

In `ui/src/AgentCanvas.tsx`:

```tsx
import { listWorkspaces, switchWorkspace, createWorkspace, connectFolder, type WorkspaceEntry } from "./workspaces";
import { DirectoryPicker } from "./DirectoryPicker";
// state:
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [picker, setPicker] = useState<null | "new" | "folder">(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const { active, workspaces } = await listWorkspaces();
      setActiveId(active);
      setWorkspaces(workspaces);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
```

- [ ] **Step 2: Reload everything on switch**

Extract the session/files loading from the existing startup `useEffect` into a `reload()` callback (sessions + folders), then:

```tsx
  async function handleSwitch(id: string) {
    if (id === activeId) return;
    await switchWorkspace(id);
    setActiveId(id);
    await reload();          // refetch /sessions (rebuilds nodes/widgets/edges/view) + /files
    await loadWorkspaces();  // refresh folder counts
  }

  async function handleNewWorkspace(dir: string) {
    await createWorkspace(dir);
    setPicker(null);
    await loadWorkspaces();
    await reload();
  }
```

`reload()` must reuse the same logic the startup effect uses (`fetchSessions().then(...)` body + `getFolders().then(buildFolderTrees)`); factor it into one function and call it from both startup and switch.

- [ ] **Step 3: Remove the free-text Directory field**

Delete the `<label className="cwd-field">…</label>` block (header lines ~612-619 from Plan 1's snapshot). Replace the header right side with a read-only active workspace label (the `workspaceName` already shown in `.workspace-title` is enough; keep the hint). Remove the `cwd`/`setCwd` text input but keep a `cwd` value derived from the active workspace's **first folder** for spawning terminals:

```tsx
  // derive cwd for new terminals from the active workspace's first folder
  const activeFolders = workspaces.find((w) => w.id === activeId)?.folders ?? [];
  const spawnCwd = activeFolders[0] ?? ".";
```

Replace `makeNode(preset, cwd, …)` call with `makeNode(preset, spawnCwd, …)`.

- [ ] **Step 4: Auto-connect a folder when a terminal targets a new dir**

Wherever `addTerminal` chooses a cwd not in `activeFolders`, connect it first:

```tsx
  async function ensureFolder(dir: string) {
    if (!activeFolders.includes(dir)) {
      await connectFolder(activeId, dir);
      await loadWorkspaces();
      await reload(); // refresh /files so the new folder shows in the tree
    }
  }
```

Call `await ensureFolder(targetCwd)` before spawning when the terminal's cwd differs from `spawnCwd`. (Today all terminals spawn at `spawnCwd`, so this is a no-op until a future per-terminal cwd picker exists; wiring it now satisfies the auto-connect requirement.)

- [ ] **Step 5: Render picker + pass props to sidebar**

```tsx
        <WorkspaceSidebar
          workspaceName={workspaceName}
          cwd={spawnCwd}
          workspaces={workspaces}
          activeId={activeId}
          onSwitchWorkspace={handleSwitch}
          onNewWorkspace={() => setPicker("new")}
          items={canvasItems}
          selectedId={selectedId}
          onSelect={focusItem}
          onAddWidget={(kind) => addWidget(kind)}
          onAddTerminal={() => addTerminal(presetById("bash"))}
          folders={folders}
          onOpenFile={onOpenFile}
          subagents={subagents}
        />
        {picker === "new" && (
          <DirectoryPicker
            title="New workspace — pick a folder"
            onCancel={() => setPicker(null)}
            onConfirm={handleNewWorkspace}
          />
        )}
```

- [ ] **Step 6: Build + test**

Run: `npm --prefix ui run build && npm --prefix ui test`
Expected: `tsc` + `vite build` succeed; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/AgentCanvas.tsx
git commit -m "feat(ui): runtime workspace switching, create via picker, drop free-text dir"
```

---

### Task E7: Manual end-to-end smoke

**Files:** none (verification only).

- [ ] **Step 1: Build + run**

```bash
npm --prefix ui run build
AGENTHUB_WORKSPACE="$PWD" cargo run
```

- [ ] **Step 2: Verify at http://127.0.0.1:3000**

Observe actual behavior:
- Sidebar shows "Workspace 01" as active; "+ New workspace" opens the picker; navigating with `..`/folders and "Select this folder" creates "Workspace 02" and switches to it (canvas + Files update).
- Switching back to "Workspace 01" restores its canvas (terminals/widgets/edges) and its folder tree.
- The header no longer has a free-text Directory input.
- `~/.agenthub/workspaces.json` exists with both workspaces; `~/.agenthub/workspaces/ws-01/sessions.json` holds ws-01's canvas.

- [ ] **Step 3: Confirm legacy migration**

If `$PWD/.agenthub/sessions.json` existed before, confirm its contents were imported into `~/.agenthub/workspaces/ws-01/sessions.json` on first run (canvas not lost).

---

## Self-Review (filled in)

**Spec coverage (Plan 2 scope):**
- Named, multi-folder workspaces + global registry `~/.agenthub/workspaces.json` → E1, E3. ✅
- Per-workspace canvas at `~/.agenthub/workspaces/<id>/sessions.json` + legacy migration → E2, E3. ✅
- Runtime switch in one server → E3 (`build_active`), E4 (`/workspaces/active`), E6. ✅
- Create / remove / rename / connect-folder endpoints → E4. ✅
- Directory picker (`/browse` + modal) used for create + connect → D1, D2, E5, E6. ✅
- Remove free-text Directory field → E6. ✅
- Auto-connect folder on new terminal cwd → E6 (`ensureFolder`). ✅
- Sidebar workspace switcher → E5. ✅
- `/browse` dirs-only, hides dotfiles, localhost-only → D1. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; tests have assertions; commands have expected output. The one conditional ("simplify the matcher if…") is guidance, not a missing implementation. ✅

**Type consistency:** `WorkspaceEntry { id, name, folders }` identical in `registry.rs` and `workspaces.ts`. `Registry` methods (`snapshot`/`entry`/`active_entry`/`create`/`set_active`/`remove`/`rename`/`add_folder`/`remove_folder`) consistent E1↔E4. `build_active`/`SharedActive`/`ActiveWorkspace` consistent with Plan 1 + E3. Frontend `listWorkspaces`/`switchWorkspace`/`createWorkspace`/`connectFolder` consistent E5↔E6. `DirectoryPicker` props `{ title, onCancel, onConfirm(dir) }` consistent D2↔E6. ✅

**Cross-plan dependency note:** Plan 2 Task E3 changes `app_router` to a 3-arg signature and `api_router` to build a registry — any code added in Plan 1 calling `app_router(active, hub)` must be updated. Both callers (`main.rs`, `api_router`) are covered in E3.
