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
