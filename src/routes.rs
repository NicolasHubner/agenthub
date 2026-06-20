use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::{
    extract::{Query, State, WebSocketUpgrade},
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

async fn pty_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        let hub = state.hub.clone();
        let folders = state.active.read().unwrap().folders.clone();
        async move {
            handle_pty_socket(hub, folders, socket).await;
        }
    })
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
