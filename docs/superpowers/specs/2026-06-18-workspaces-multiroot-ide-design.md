# Multi-root Workspaces + IDE Editor — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming)

## Problem

The AgentHub canvas binds to a single directory chosen at launch via a free-text
"Directory" field. Three pain points:

1. **Free-text directory is error-prone.** No way to browse the filesystem like a
   normal OS file picker; users hand-type paths and make mistakes.
2. **One directory only.** A user may work across two unrelated repos at once (or a
   monorepo). There is no concept of a named workspace that groups several folders.
3. **The right-side file viewer is unreadable.** Opening a file shows
   black-on-black (Prism highlighter has no theme imported) and is read-only — it
   should be a real editor.

## Goals

- A **workspace** is a *named* container (e.g. "Workspace 01") holding **one or more
  folders/repos** — VS Code multi-root style.
- Folders appear in the left sidebar automatically when connected, including when a
  terminal spawns in a directory not yet part of the active workspace.
- Browse the filesystem with a directory picker instead of typing paths.
- The right-side panel is a real editor (CodeMirror 6, Dracula theme, line numbers,
  indentation, language by extension) that **saves back to disk**.
- Switch between workspaces at runtime in one running server.

## Non-goals

- Lazy/incremental file-tree loading (current full recursive `/files` is kept; noted
  as future work for very large repos).
- Editing binary files, creating files from the UI, or a full file-manager
  (rename/delete/move). Out of scope.
- Remote/multi-user workspaces. Single local user, bound to `127.0.0.1`.

## Data model

### Global registry — `~/.agenthub/workspaces.json`

```jsonc
{
  "active": "ws-01",
  "workspaces": [
    { "id": "ws-01", "name": "Workspace 01", "folders": ["/abs/repo-a", "/abs/repo-b"] }
  ]
}
```

- `id`: stable slug (`ws-01`, `ws-02`, …) assigned on create.
- `name`: human label, defaults to `Workspace NN`, editable.
- `folders`: absolute, canonicalized directory paths. 1+ entries.
- `active`: id of the currently selected workspace.

Home dir resolved via `$HOME` (Unix) / `$USERPROFILE` (Windows). No new crate.

### Per-workspace canvas — `~/.agenthub/workspaces/<id>/sessions.json`

Canvas state (terminals, widgets, edges, view) moves from the project's
`<dir>/.agenthub/sessions.json` to a global per-workspace-id location, because a
workspace is no longer a single directory. The `SessionSnapshot` shape is unchanged.

**Migration:** on first startup with no registry, seed `Workspace 01` from the launch
dir (`AGENTHUB_WORKSPACE` or cwd). If that dir has a legacy
`<dir>/.agenthub/sessions.json`, load it as the seed workspace's canvas.

## Backend (Rust)

### `Workspace` (existing) — unchanged role

Stays a **single-root sandbox**: `resolve()` path-traversal guard, `list_files()`,
`read_file()`, plus a **new** `write_file()`. One per folder.

```rust
// new on Workspace
pub fn write_file(&self, rel: &str, content: &str) -> Result<(), WorkspaceError>;
// resolves rel via the existing guard (target must already exist inside root — edit
// only, matching the non-goal of no file creation), enforces MAX_FILE_BYTES, UTF-8.
```

### New `registry.rs`

```rust
pub struct WorkspaceEntry { pub id: String, pub name: String, pub folders: Vec<String> }
pub struct Registry { /* path: ~/.agenthub/workspaces.json, data: Mutex<RegistryData> */ }

impl Registry {
    fn load_or_seed(seed_dir: &Path) -> Self;          // seed Workspace 01 if empty
    fn list(&self) -> (String /*active*/, Vec<WorkspaceEntry>);
    fn create(&self, name: Option<String>, folder: String) -> WorkspaceEntry; // assigns ws-NN
    fn remove(&self, id: &str);
    fn add_folder(&self, id: &str, dir: String);       // no-op if already present
    fn remove_folder(&self, id: &str, dir: &str);
    fn set_active(&self, id: &str);
    fn rename(&self, id: &str, name: String);
    fn save(&self);                                     // atomic write to disk
}
```

### Active workspace state

```rust
pub struct ActiveWorkspace {
    pub id: String,
    pub folders: Vec<Arc<Workspace>>,   // one sandbox per folder
    pub sessions: Arc<SessionStore>,    // ~/.agenthub/workspaces/<id>/sessions.json
}

pub struct AppState {
    pub registry: Arc<Registry>,
    pub active: Arc<RwLock<ActiveWorkspace>>,
    pub hub: SharedHub,
}
```

Switching active: read registry entry → build `Vec<Workspace>` from its folders +
`SessionStore` for `<id>` → swap into `active` under the write lock.

### Folder addressing

A folder is identified in the API by its **absolute root path** (already canonical in
the registry). No separate id mapping. `/file` requests carry `root` + `path`; the
handler finds the matching `Workspace` in `active.folders` and delegates to its guarded
`resolve`/`read_file`/`write_file`. A `root` not in the active workspace → 403.

### Endpoints

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/workspaces` | — | `{ active, workspaces: [entry] }` |
| POST | `/workspaces` | `{ name?, folder }` | created `entry`, sets active |
| DELETE | `/workspaces/:id` | — | 204 |
| POST | `/workspaces/active` | `{ id }` | 204 (swaps active) |
| POST | `/workspaces/:id/folders` | `{ dir }` | 204 (validates dir exists) |
| DELETE | `/workspaces/:id/folders` | `{ dir }` | 204 |
| PATCH | `/workspaces/:id` | `{ name }` | 204 (rename) |
| GET | `/browse` | `?path=` (empty → `$HOME`) | `{ path, parent, entries:[{name,dir:true}] }` |
| GET | `/files` | — | `{ folders: [{ name, root, files:[rel] }] }` |
| GET | `/file` | `?root=&path=` | `FileContent` (+ existing guards) |
| PUT | `/file` | `?root=&path=` body `{ content }` | 204 |

- `/browse` lists immediate **subdirectories** only, hides dotfiles, includes `parent`
  for "up". Localhost-only FS exposure is acceptable for a local dev tool.
- `/files` and `/file` operate over the **active** workspace's folders.
- Existing `/sessions` GET/PUT now target the active workspace's `SessionStore`. The
  tmux kill-on-remove diff in `put_sessions` stays scoped to the active store, so
  switching workspaces never kills terminals.

### PTY / auto-connect folder

When a terminal is created with a `cwd` that is not under any folder of the active
workspace, the **frontend** calls `POST /workspaces/:id/folders` before/after spawn so
the folder shows up in the sidebar. (Frontend-driven keeps `pty.rs` decoupled; the cwd
is already known at creation time.)

## Frontend (React)

### New deps

`@uiw/react-codemirror`, `@uiw/codemirror-theme-dracula`,
`@uiw/codemirror-extensions-langs`.

### Components

1. **Workspace switcher** (extend `WorkspaceSidebar` "Workspaces" section)
   - Lists all workspaces; active highlighted. Click → `POST /workspaces/active` then
     reload `/sessions` + `/files`.
   - "New workspace" button → opens the directory-picker modal (name + initial folder).
   - Per-workspace overflow: rename, connect folder, remove.

2. **`DirectoryPicker` modal** (new)
   - Breadcrumb of the current path, `..` up, list of subdirs (click to descend),
     "Select this folder" confirm. Backed by `GET /browse`.
   - Used for both *create workspace* (initial folder) and *connect folder*.
   - The header's free-text "Directory" input is **removed**; the active workspace and
     its folders are shown read-only, edited only through the picker.

3. **Multi-root `FileTree`** (rewrite `FileTree.tsx` + `tree.ts`)
   - Top level = one collapsible node per connected folder (repo basename; disambiguate
     duplicate basenames via full-path tooltip).
   - Each folder expands to a collapsible directory tree (per-folder expand/collapse
     state, chevrons, folder/file icons, depth indentation). Default: folders collapsed.
   - Selecting a file calls `onOpenFile(root, relPath)`.

4. **`Editor`** (replace `Viewer.tsx`)
   - CodeMirror 6 via `@uiw/react-codemirror`: Dracula theme, line numbers, indentation,
     language extension chosen by file extension (`loadLanguage`).
   - Tracks dirty state; `Ctrl/Cmd+S` → `PUT /file?root=&path=`. Dirty dot in header.
   - `.md` files get an edit/preview toggle (preview reuses `react-markdown`).
   - Falls back to plain text for unknown extensions.

### App wiring (`App.tsx`, `AgentCanvas.tsx`)

- `App` tracks the open file as `{ root, path, content }`; `getFile(root, path)`.
- `AgentCanvas` drops the free-text `cwd` field; `cwd` for new terminals comes from a
  folder chosen from the active workspace (default: first folder). On terminal create
  with a new cwd → auto-connect folder + refresh `/files`.
- On workspace switch → refetch sessions/files/edges and rebuild the canvas.

## Error handling

- Picker / create / connect against a non-existent or non-dir path → 404, surfaced as a
  toast/inline error in the modal.
- `root` outside the active workspace, or `path` traversal → 403 (existing guard).
- `PUT /file` over `MAX_FILE_BYTES` → 413; non-UTF-8 target → 415.
- Save failure → editor keeps dirty state and shows the error; no silent success.
- Switching to a workspace whose folder was deleted on disk → that folder is shown as
  unavailable (greyed), others still load; no hard failure.

## Testing

**Rust**
- `Registry`: create assigns sequential ids; add/remove folder idempotency; set_active;
  rename; persistence round-trip; seed-from-launch-dir + legacy sessions migration.
- `write_file`: writes within root, rejects traversal/absolute, enforces size cap.
- `/browse`: lists subdirs, returns parent, hides dotfiles, empty path → `$HOME`.
- `/files` aggregates across multiple folders; `/file` resolves by `root`, 403 on
  unknown root.

**Frontend**
- `tree.ts`: multi-root build + per-node collapse state.
- `DirectoryPicker`: navigation (descend, up, select).
- `Editor`: dirty tracking + save call; markdown edit/preview toggle.
- Workspace switcher: switch triggers reload.

## Build order

1. **Editor** — CodeMirror + Dracula + `PUT /file` + `write_file`. (Immediate pain.)
2. **Multi-root file tree** — collapsible, grouped by folder; `/files` folder grouping.
3. **Directory picker** — `/browse` + modal.
4. **Workspaces** — registry, active state, switch/create/connect endpoints + sidebar;
   auto-connect on new terminal cwd; canvas storage migration.

Steps 1–2 are independent of the workspace refactor and can land first; step 4 depends
on the picker (3) for the create/connect flow.
