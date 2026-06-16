mod workspace;

use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/health", get(|| async { "ok" }));
    let port: u16 = std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("agenthub listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve");
}
