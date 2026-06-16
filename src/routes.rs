use std::sync::Arc;

use axum::{
    extract::{Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::hub::{Hub, SharedHub};
use crate::workspace::{Workspace, WorkspaceError};

pub type SharedWorkspace = Arc<Workspace>;

#[derive(Clone)]
pub struct AppState {
    pub workspace: SharedWorkspace,
    pub hub: SharedHub,
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

/// Full API router (files + hub). Used by main and tests.
pub fn app_router(workspace: SharedWorkspace, hub: SharedHub) -> Router {
    let state = AppState { workspace, hub };
    Router::new()
        .route("/state", get(get_state))
        .route("/files", get(get_files))
        .route("/file", get(get_file))
        .route("/ws", get(ws_upgrade))
        .with_state(state)
}

/// Back-compat helper for file-only tests.
pub fn api_router(ws: SharedWorkspace) -> Router {
    app_router(ws, Arc::new(Hub::new()))
}
