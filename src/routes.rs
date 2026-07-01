use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::{
    extract::{Path as AxPath, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::hub::{Hub, SharedHub};
use crate::pty::handle_pty_socket;
use crate::registry::{Registry, WorkspaceEntry, workspace_state_dir};
use crate::sessions::{SessionSnapshot, SessionStore};
use crate::workspace::{Workspace, WorkspaceError};

pub type SharedActive = Arc<RwLock<ActiveWorkspace>>;

pub struct ActiveWorkspace {
    pub id: String,
    pub folders: Vec<Arc<Workspace>>,
    pub sessions: Arc<SessionStore>,
}

impl ActiveWorkspace {
    /// First folder — the default cwd / single-folder convenience.
    pub fn primary(&self) -> Option<Arc<Workspace>> {
        self.folders.first().cloned()
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

fn normalize_workspace_sessions(
    _entry: &WorkspaceEntry,
    folders: &[Arc<Workspace>],
    mut snap: SessionSnapshot,
) -> (SessionSnapshot, bool) {
    let mut changed = false;
    let mut renamed = HashMap::new();
    let mut used_names = HashSet::new();
    let mut kept_ids = HashSet::new();
    let old_terminals = std::mem::take(&mut snap.terminals);
    let old_edges = std::mem::take(&mut snap.edges);
    let old_widget_edges = std::mem::take(&mut snap.widget_edges);
    let mut terminals = Vec::with_capacity(old_terminals.len());

    for mut terminal in old_terminals {
        let cwd_ok = folders.iter().any(|w| w.resolve_dir(&terminal.cwd).is_ok());
        if !cwd_ok {
            changed = true;
            continue;
        }

        let original_name = terminal.name.clone();
        let base_name = terminal.name.trim().to_string();
        let base_name = if base_name.is_empty() {
            "agent".to_string()
        } else {
            base_name
        };
        let mut next_name = base_name.clone();
        let mut n = 2;
        while used_names.contains(&next_name) {
            next_name = format!("{base_name}-{n}");
            n += 1;
        }
        if next_name != terminal.name {
            terminal.name = next_name.clone();
            changed = true;
        }
        renamed.insert(original_name, next_name);
        used_names.insert(terminal.name.clone());
        kept_ids.insert(terminal.id.clone());
        terminals.push(terminal);
    }

    let mut edge_seen = HashSet::new();
    let edges = old_edges
        .into_iter()
        .filter_map(|[a, b]| {
            let a = renamed.get(&a).cloned()?;
            let b = renamed.get(&b).cloned()?;
            if a == b {
                changed = true;
                return None;
            }
            let key = if a <= b { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
            if !edge_seen.insert(key) {
                changed = true;
                return None;
            }
            Some([a, b])
        })
        .collect();

    let widget_edges = old_widget_edges
        .into_iter()
        .filter(|[node_id, _]| {
            let keep = kept_ids.contains(node_id);
            if !keep {
                changed = true;
            }
            keep
        })
        .collect();

    snap.terminals = terminals;
    snap.edges = edges;
    snap.widget_edges = widget_edges;
    (snap, changed)
}

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
    let store = SessionStore::new_in(&state_dir);
    let (snap, changed) = normalize_workspace_sessions(entry, &folders, store.get());
    if changed {
        let _ = store.save(snap);
    }
    let sessions = Arc::new(store);
    ActiveWorkspace { id: entry.id.clone(), folders, sessions }
}

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

async fn get_state(State(state): State<AppState>) -> Json<serde_json::Value> {
    let snap = state.hub.state();
    Json(serde_json::to_value(snap).expect("state serializes"))
}

async fn get_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let entry = state
        .registry
        .active_entry();
    let name = entry
        .as_ref()
        .map(|e| e.name.clone())
        .unwrap_or_else(|| "Workspace".into());
    let active = state.active.read().unwrap();
    let snap = active.sessions.get();
    Json(json!({
        "workspaceId": active.id.clone(),
        "workspace": name,
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
    let (workspace_id, folders, sessions) = {
        let active = state.active.read().unwrap();
        (active.id.clone(), active.folders.clone(), active.sessions.clone())
    };
    let entry = state
        .registry
        .entry(&workspace_id)
        .ok_or(ApiError(StatusCode::NOT_FOUND, "unknown workspace"))?;
    let (body, _) = normalize_workspace_sessions(&entry, &folders, body);
    let prev: std::collections::HashSet<String> =
        sessions.get().terminals.into_iter().map(|t| t.name).collect();
    let next: std::collections::HashSet<String> =
        body.terminals.iter().map(|t| t.name.clone()).collect();
    for removed in prev.difference(&next) {
        crate::pty::kill_tmux_session(&workspace_id, removed).await;
    }
    sessions
        .save(body)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "io error"))?;
    Ok(StatusCode::NO_CONTENT)
}

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

async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        let hub = state.hub.clone();
        async move {
            hub.handle_socket(socket).await;
        }
    })
}

async fn post_msg(
    State(state): State<AppState>,
    Json(body): Json<MsgBody>,
) -> Response {
    if body.awaiting_reply {
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        if let Err(err) = state.hub.route_msg_with_reply(&body.from, &body.to, &body.content, tx) {
            return (StatusCode::BAD_REQUEST, Json(err)).into_response();
        }
        match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
            Ok(Ok(reply)) => Json(serde_json::json!({"reply": reply})).into_response(),
            _ => StatusCode::REQUEST_TIMEOUT.into_response(),
        }
    } else {
        match state.hub.route_msg(&body.from, &body.to, &body.content) {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(err) => (StatusCode::BAD_REQUEST, Json(err)).into_response(),
        }
    }
}

async fn post_reply(
    State(state): State<AppState>,
    Json(body): Json<ReplyBody>,
) -> Response {
    match state.hub.deliver_reply(&body.from, &body.to, &body.content) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(err)).into_response(),
    }
}

#[derive(Deserialize)]
struct MsgBody {
    from: String,
    to: String,
    content: String,
    #[serde(default)]
    awaiting_reply: bool,
}

#[derive(Deserialize)]
struct ReplyBody {
    from: String,
    to: String,
    content: String,
}

async fn post_note(State(state): State<AppState>, Json(body): Json<NoteBody>) -> Response {
    match state
        .hub
        .route_note(&body.from, body.to, &body.content, &body.mode)
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(err)).into_response(),
    }
}

fn default_mode() -> String {
    "append".into()
}

#[derive(Deserialize)]
struct NoteBody {
    from: String,
    #[serde(default)]
    to: Option<String>,
    content: String,
    #[serde(default = "default_mode")]
    mode: String,
}

async fn post_subagent(
    State(state): State<AppState>,
    Json(body): Json<SubagentBody>,
) -> StatusCode {
    state.hub.upsert_subagent(body.id, body.label, body.status);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct SubagentBody {
    id: String,
    label: String,
    status: String,
}

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
    entries.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });
    let parent = dir.parent().and_then(|p| if p == dir { None } else { Some(p.display().to_string()) });
    Ok(Json(json!({
        "path": dir.display().to_string(),
        "parent": parent,
        "entries": entries,
    })))
}

/// List persistent agenthub tmux sessions so the UI can restore orphaned
/// terminals (sessions alive in tmux but absent from the saved canvas layout).
/// Scoped to the active workspace: only sessions whose cwd lives under one of the
/// active folders are returned, so a workspace never restores another's terminals.
async fn get_tmux_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let (workspace_id, roots): (String, Vec<PathBuf>) = {
        let active = state.active.read().unwrap();
        (
            active.id.clone(),
            active.folders.iter().map(|w| w.root().to_path_buf()).collect(),
        )
    };
    let sessions: Vec<_> = crate::pty::list_tmux_sessions()
        .await
        .into_iter()
        .filter(|s| {
            // Empty cwd (unknown pane path) can't be attributed to a workspace; drop it.
            (s.workspace_id == workspace_id || s.workspace_id.is_empty())
                && !s.cwd.is_empty()
                && roots.iter().any(|r| std::path::Path::new(&s.cwd).starts_with(r))
        })
        .collect();
    Json(json!({ "sessions": sessions }))
}

async fn pty_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        let hub = state.hub.clone();
        let active = state.active.read().unwrap();
        let workspace_id = active.id.clone();
        let folders = active.folders.clone();
        async move {
            handle_pty_socket(hub, workspace_id, folders, socket).await;
        }
    })
}

async fn get_workspaces(State(state): State<AppState>) -> Json<serde_json::Value> {
    let (active, list) = state.registry.snapshot();
    Json(json!({ "active": active, "workspaces": list }))
}

#[derive(Deserialize)]
struct CreateWsBody {
    #[serde(default)]
    name: Option<String>,
    folder: String,
}

async fn post_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWsBody>,
) -> Result<Json<WorkspaceEntry>, ApiError> {
    let ws = Workspace::new(&body.folder).map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such folder"))?;
    let entry = state.registry.create(body.name, ws.root_display());
    *state.active.write().unwrap() = build_active(&entry);
    Ok(Json(entry))
}

#[derive(Deserialize)]
struct ActiveBody {
    id: String,
}

async fn post_active(
    State(state): State<AppState>,
    Json(body): Json<ActiveBody>,
) -> Result<StatusCode, ApiError> {
    if !state.registry.set_active(&body.id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "unknown workspace"));
    }
    if let Some(entry) = state.registry.active_entry() {
        *state.active.write().unwrap() = build_active(&entry);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_workspace(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
) -> Result<StatusCode, ApiError> {
    let (current_active, workspaces) = state.registry.snapshot();
    if !workspaces.iter().any(|w| w.id == id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "unknown workspace"));
    }
    let was_active = current_active == id;
    state.registry.remove(&id);
    if was_active {
        match state.registry.active_entry() {
            Some(entry) => *state.active.write().unwrap() = build_active(&entry),
            None => {
                *state.active.write().unwrap() = ActiveWorkspace {
                    id: String::new(),
                    folders: vec![],
                    sessions: std::sync::Arc::new(crate::sessions::SessionStore::new_in(
                        &std::path::Path::new("/tmp"),
                    )),
                };
            }
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RenameBody {
    name: String,
}

async fn patch_workspace(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<RenameBody>,
) -> Result<StatusCode, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty workspace name"));
    }
    if !state.registry.rename(&id, name.to_string()) {
        return Err(ApiError(StatusCode::NOT_FOUND, "unknown workspace"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct FolderBody {
    dir: String,
}

async fn post_folder(
    State(state): State<AppState>,
    AxPath(id): AxPath<String>,
    Json(body): Json<FolderBody>,
) -> Result<StatusCode, ApiError> {
    let ws = Workspace::new(&body.dir).map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such folder"))?;
    let canon = ws.root_display();
    state.registry.add_folder(&id, canon.clone());
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
    let canon = Workspace::new(&body.dir)
        .map(|w| w.root_display())
        .unwrap_or(body.dir);
    state.registry.remove_folder(&id, &canon);
    if state.registry.snapshot().0 == id {
        let mut active = state.active.write().unwrap();
        active.folders.retain(|w| w.root_display() != canon);
    }
    StatusCode::NO_CONTENT
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
        .route("/tmux/sessions", get(get_tmux_sessions))
        .route("/files", get(get_files))
        .route("/file", get(get_file).put(put_file))
        .route("/browse", get(get_browse))
        .route("/workspaces", get(get_workspaces).post(post_workspace))
        .route("/workspaces/active", post(post_active))
        .route("/workspaces/:id", axum::routing::delete(delete_workspace).patch(patch_workspace))
        .route("/workspaces/:id/folders", post(post_folder).delete(delete_folder))
        .route("/ws", get(ws_upgrade))
        .route("/ws/pty", get(pty_upgrade))
        .with_state(state)
}

/// Test/helper constructor: one workspace folder, sessions under its root.
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
