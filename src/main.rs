use std::sync::Arc;

use agenthub::hub::Hub;
use agenthub::routes::app_router;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    let workspace_root = std::env::var("AGENTHUB_WORKSPACE").unwrap_or_else(|_| ".".to_string());
    let ui_dir = std::env::var("AGENTHUB_UI_DIR").unwrap_or_else(|_| "ui/dist".to_string());
    let port: u16 = std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let hub = Arc::new(Hub::new());
    let registry = Arc::new(agenthub::registry::Registry::open(
        agenthub::registry::Registry::default_path(),
    ));
    registry.seed_if_empty(std::path::Path::new(&workspace_root));
    let entry = registry.active_entry().expect("seeded workspace exists");
    let active = Arc::new(std::sync::RwLock::new(agenthub::routes::build_active(&entry)));

    let index = format!("{ui_dir}/index.html");
    let static_service = ServeDir::new(&ui_dir).fallback(ServeFile::new(index));
    let app = app_router(active, hub, registry).fallback_service(static_service);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("agenthub: http://127.0.0.1:{port}  ws://127.0.0.1:{port}/ws");
    println!("agenthub: workspace {}", entry.name);
    axum::serve(listener, app).await.expect("serve");
}
