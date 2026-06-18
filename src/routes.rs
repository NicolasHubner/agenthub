use std::sync::Arc;

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
use crate::sessions::{SessionSnapshot, SessionStore};
use crate::workspace::{Workspace, WorkspaceError};

pub type SharedWorkspace = Arc<Workspace>;

#[derive(Clone)]
pub struct AppState {
    pub workspace: SharedWorkspace,
    pub hub: SharedHub,
    pub sessions: Arc<SessionStore>,
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
    let snap = state.sessions.get();
    Json(json!({
        "workspace": state.workspace.root_display(),
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
    // Terminals dropped from the canvas are gone for good: kill their
    // persistent tmux sessions so dead/orphaned sessions don't pile up.
    // Plain reloads re-save the same set, so nothing is killed.
    let prev: std::collections::HashSet<String> = state
        .sessions
        .get()
        .terminals
        .into_iter()
        .map(|t| t.name)
        .collect();
    let next: std::collections::HashSet<String> =
        body.terminals.iter().map(|t| t.name.clone()).collect();
    for removed in prev.difference(&next) {
        crate::pty::kill_tmux_session(removed).await;
    }

    state
        .sessions
        .save(body)
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "io error"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_files(State(state): State<AppState>) -> Response {
    Json(json!({ "files": state.workspace.list_files() })).into_response()
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

async fn get_file(
    State(state): State<AppState>,
    Query(q): Query<FileQuery>,
) -> Result<Json<crate::workspace::FileContent>, ApiError> {
    Ok(Json(state.workspace.read_file(&q.path)?))
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

async fn pty_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        let hub = state.hub.clone();
        let workspace = state.workspace.clone();
        async move {
            handle_pty_socket(hub, workspace, socket).await;
        }
    })
}

pub fn app_router(workspace: SharedWorkspace, hub: SharedHub, sessions: Arc<SessionStore>) -> Router {
    let state = AppState {
        workspace,
        hub,
        sessions,
    };
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

pub fn api_router(ws: SharedWorkspace) -> Router {
    let root = ws.root_display();
    let sessions = Arc::new(SessionStore::new(std::path::Path::new(&root)));
    app_router(ws, Arc::new(Hub::new()), sessions)
}
