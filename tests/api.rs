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
