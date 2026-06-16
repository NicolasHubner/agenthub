use std::sync::Arc;

use agenthub::routes::api_router;
use agenthub::workspace::Workspace;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    let workspace_root = std::env::var("AGENTHUB_WORKSPACE").unwrap_or_else(|_| ".".to_string());
    let ui_dir = std::env::var("AGENTHUB_UI_DIR").unwrap_or_else(|_| "ui/dist".to_string());
    let port: u16 = std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let ws = Arc::new(Workspace::new(&workspace_root).expect("workspace root must exist"));

    // Static UI with SPA fallback: unknown paths serve index.html.
    let index = format!("{ui_dir}/index.html");
    let static_service = ServeDir::new(&ui_dir).fallback(ServeFile::new(index));

    let app = api_router(ws).fallback_service(static_service);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("agenthub: serving {workspace_root} on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve");
}
