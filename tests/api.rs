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

#[tokio::test]
async fn browse_returns_home() {
    let app = api_router(ws());
    let resp = app
        .oneshot(Request::builder().uri("/browse").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = body_string(resp).await;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert!(!v["path"].as_str().unwrap_or("").is_empty());
}

#[tokio::test]
async fn browse_lists_subdirs() {
    let base = std::env::temp_dir().join(format!("agenthub-browse-sub-{}", std::process::id()));
    fs::create_dir_all(base.join("mysubdir")).unwrap();
    fs::write(base.join("somefile.txt"), "x").unwrap();
    let app = api_router(ws());
    let canon = base.canonicalize().unwrap();
    let uri = format!("/browse?path={}", urlencoding(&canon.display().to_string()));
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = body_string(resp).await;
    assert!(text.contains("\"mysubdir\""), "expected mysubdir in: {text}");
    assert!(!text.contains("somefile.txt"), "files should be excluded: {text}");
}

#[tokio::test]
async fn browse_hides_dotfiles() {
    let base =
        std::env::temp_dir().join(format!("agenthub-browse-dot-{}", std::process::id()));
    fs::create_dir_all(base.join(".hidden")).unwrap();
    fs::create_dir_all(base.join("visible")).unwrap();
    let app = api_router(ws());
    let canon = base.canonicalize().unwrap();
    let uri = format!("/browse?path={}", urlencoding(&canon.display().to_string()));
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = body_string(resp).await;
    assert!(!text.contains("\".hidden\""), "dotdir should be hidden: {text}");
    assert!(text.contains("\"visible\""), "visible dir should appear: {text}");
}

#[tokio::test]
async fn browse_nonexistent_returns_404() {
    let app = api_router(ws());
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/browse?path=/nonexistent/xyz/agenthub-missing")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

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
                .body(Body::from(r##"{"content":"# saved"}"##))
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
