#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::path::BaseDirectory;

struct ServerProcess(Mutex<Option<Child>>);

fn server_port() -> u16 {
    std::env::var("AGENTHUB_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000)
}

// Locate the agenthub server binary: env override, bundled resource (packaged
// app), release/debug builds next to this executable's workspace, then PATH.
fn find_server_binary(app: &tauri::App) -> PathBuf {
    if let Ok(p) = std::env::var("AGENTHUB_BIN") {
        return PathBuf::from(p);
    }
    if let Ok(resource) = app.path().resolve("agenthub", BaseDirectory::Resource) {
        if resource.exists() {
            return resource;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        // exe lives at .../target/{debug,release}/agenthub-desktop (dev)
        // or .../target/{debug,release}/bundle/... (packaged) - walk up to find "target".
        let mut dir = exe.parent().map(PathBuf::from);
        while let Some(d) = dir {
            for profile in ["release", "debug"] {
                let candidate = d.join("target").join(profile).join("agenthub");
                if candidate.exists() {
                    return candidate;
                }
            }
            let candidate = d.join("agenthub");
            if candidate.exists() && candidate != exe {
                return candidate;
            }
            dir = d.parent().map(PathBuf::from);
        }
    }
    PathBuf::from("agenthub")
}

// Locate the built UI (ui/dist): env override, bundled resource (packaged
// app), then the workspace checkout next to the server binary (dev).
fn find_ui_dir(app: &tauri::App, bin: &std::path::Path) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("AGENTHUB_UI_DIR") {
        return Some(PathBuf::from(p));
    }
    if let Ok(resource) = app.path().resolve("ui-dist", BaseDirectory::Resource) {
        if resource.is_dir() {
            return Some(resource);
        }
    }
    // bin is .../target/{release,debug}/agenthub inside the repo checkout.
    let dist = bin.parent()?.parent()?.parent()?.join("ui").join("dist");
    dist.is_dir().then_some(dist)
}

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let url = format!("http://127.0.0.1:{port}/");
    while std::time::Instant::now() < deadline {
        if ureq::get(&url).call().is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn main() {
    // WebKitGTK on many Linux/GPU combos paints a blank, sluggish window because
    // of DMABUF / accelerated-compositing driver bugs. Force the software paths
    // before the webview is created so the UI renders reliably.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    let port = server_port();

    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(move |app| {
            let bin = find_server_binary(app);
            let ui_dir = find_ui_dir(app, &bin);
            let workspace = std::env::var("AGENTHUB_WORKSPACE").unwrap_or_else(|_| {
                std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
            });
            let mut cmd = Command::new(&bin);
            cmd.env("AGENTHUB_PORT", port.to_string())
                .env("AGENTHUB_WORKSPACE", workspace)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit());
            if let Some(ui_dir) = &ui_dir {
                cmd.env("AGENTHUB_UI_DIR", ui_dir);
            } else {
                eprintln!("agenthub-desktop: could not locate ui/dist; UI will 404");
            }
            let child = cmd
                .spawn()
                .unwrap_or_else(|e| panic!("failed to start agenthub server ({bin:?}): {e}"));

            app.state::<ServerProcess>().0.lock().unwrap().replace(child);

            if !wait_for_server(port, Duration::from_secs(15)) {
                eprintln!("agenthub-desktop: server did not respond on port {port} in time");
            }

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse().unwrap()),
            )
            .title("AgentHub")
            .inner_size(1400.0, 900.0)
            .build()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(mut child) = window
                    .app_handle()
                    .state::<ServerProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running agenthub-desktop");
}
