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
        "view": snap.view,
    }))
}

async fn put_sessions(
    State(state): State<AppState>,
    Json(body): Json<SessionSnapshot>,
) -> Result<StatusCode, ApiError> {
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
    match state.hub.route_msg(&body.from, &body.to, &body.content) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(err)).into_response(),
    }
}

#[derive(Deserialize)]
struct MsgBody {
    from: String,
    to: String,
    content: String,
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
