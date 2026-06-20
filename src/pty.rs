use std::io::{Read, Write};

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use tokio::sync::mpsc;

use std::sync::Arc;

use crate::hub::SharedHub;

#[derive(Debug, Deserialize)]
struct SpawnMsg {
    #[serde(rename = "type")]
    kind: String,
    name: String,
    #[serde(default = "default_cmd")]
    command: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}

fn default_cmd() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "bash".into())
}
fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

#[derive(Debug, Deserialize)]
struct ResizeMsg {
    #[serde(rename = "type")]
    kind: String,
    cols: u16,
    rows: u16,
}

fn tmux_available() -> bool {
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::split_paths(&path).any(|dir| {
        std::fs::metadata(dir.join("tmux"))
            .map(|m| m.is_file())
            .unwrap_or(false)
    })
}

/// tmux persistence is on by default (sessions survive UI disconnect).
/// Opt out with AGENTHUB_USE_TMUX=0. Falls back to plain shell if tmux is missing.
fn use_tmux() -> bool {
    let enabled = match std::env::var("AGENTHUB_USE_TMUX") {
        Ok(v) => !(v == "0" || v.eq_ignore_ascii_case("false")),
        Err(_) => true,
    };
    enabled && tmux_available()
}

/// Stable tmux session name for a terminal, mirroring the sanitization used at spawn.
pub fn tmux_session_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("agenthub-{sanitized}")
}

/// Best-effort kill of a terminal's persistent tmux session (used when the UI
/// permanently removes a terminal node). No-op when tmux is unavailable.
pub async fn kill_tmux_session(name: &str) {
    if !tmux_available() {
        return;
    }
    let session = tmux_session_name(name);
    let _ = tokio::process::Command::new("tmux")
        .args(["kill-session", "-t", &session])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
}

fn inject_hub_env(cmd: &mut CommandBuilder, spawn: &SpawnMsg) {
    let port = std::env::var("AGENTHUB_PORT").unwrap_or_else(|_| "3000".into());
    cmd.env("AGENTHUB_NAME", &spawn.name);
    cmd.env(
        "AGENTHUB_URL",
        format!("http://127.0.0.1:{port}"),
    );
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let path = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}:{}", dir.display(), path));
        }
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Run agent CLI when installed; otherwise keep an interactive shell open.
pub fn agent_launch_script(command: &str) -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell_q = shell_quote(&shell);
    let cmd = command.trim();
    if cmd.is_empty() || matches!(cmd, "bash" | "sh" | "zsh" | "fish") || cmd == shell {
        return format!("exec {shell_q} -i");
    }
    let cmd_q = shell_quote(cmd);
    format!(
        "if command -v {cmd_q} >/dev/null 2>&1; then {cmd_q}; exec {shell_q} -i; \
         else printf '\\n\\x1b[33m%s: command not found — starting interactive shell\\x1b[0m\\n\\n' {cmd_q}; \
         exec {shell_q} -i; fi"
    )
}

fn shell_command(spawn: &SpawnMsg, cwd: &str) -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-lc");
    cmd.arg(agent_launch_script(&spawn.command));
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    inject_hub_env(&mut cmd, spawn);
    cmd
}

fn tmux_command(spawn: &SpawnMsg, cwd: &str) -> CommandBuilder {
    let session = tmux_session_name(&spawn.name);
    // remain-on-exit keeps the pane (and session) alive after the process
    // exits, so reopening the UI always re-attaches to the exact prior state
    // instead of respawning a fresh shell.
    let inner = format!(
        "export TERM=xterm-256color COLORTERM=truecolor; \
         tmux set-option -w remain-on-exit on 2>/dev/null; {}",
        agent_launch_script(&spawn.command)
    );
    let mut cmd = CommandBuilder::new("tmux");
    cmd.arg("new-session");
    cmd.arg("-A");
    cmd.arg("-s");
    cmd.arg(session);
    cmd.arg("-c");
    cmd.arg(cwd);
    cmd.arg("bash");
    cmd.arg("-lc");
    cmd.arg(inner);
    cmd.env("TERM", "xterm-256color");
    inject_hub_env(&mut cmd, spawn);
    cmd
}

async fn send_error(ws_tx: &mut futures::stream::SplitSink<WebSocket, Message>, reason: &str) {
    let err = serde_json::json!({"type":"error","reason": reason});
    let _ = ws_tx.send(Message::Text(err.to_string())).await;
}

pub async fn handle_pty_socket(hub: SharedHub, folders: Vec<Arc<crate::workspace::Workspace>>, socket: WebSocket) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    let first = match ws_rx.next().await {
        Some(Ok(Message::Text(t))) => t,
        _ => {
            send_error(&mut ws_tx, "expected spawn message").await;
            return;
        }
    };

    let spawn: SpawnMsg = match serde_json::from_str::<SpawnMsg>(&first) {
        Ok(s) if s.kind == "spawn" => s,
        _ => {
            send_error(&mut ws_tx, "first message must be spawn").await;
            return;
        }
    };

    let cwd = match folders.iter().find_map(|w| w.resolve_dir(&spawn.cwd).ok()) {
        Some(p) => p,
        None => {
            send_error(&mut ws_tx, "invalid cwd (must be inside a workspace folder)").await;
            return;
        }
    };
    let cwd_str = cwd.display().to_string();

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: spawn.rows,
        cols: spawn.cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            send_error(&mut ws_tx, &format!("pty open failed: {e}")).await;
            return;
        }
    };

    let cmd = if use_tmux() {
        tmux_command(&spawn, &cwd_str)
    } else {
        shell_command(&spawn, &cwd_str)
    };

    let _child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            send_error(&mut ws_tx, &format!("spawn failed: {e}")).await;
            return;
        }
    };

    let master = pair.master;
    let mut reader = match master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            send_error(&mut ws_tx, &format!("pty reader failed: {e}")).await;
            return;
        }
    };
    let writer = match master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            send_error(&mut ws_tx, &format!("pty writer failed: {e}")).await;
            return;
        }
    };

    let (pty_in_tx, mut pty_in_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();
    let name = spawn.name.clone();

    if let Err(err) = hub.register(
        spawn.name.clone(),
        spawn.tags,
        None,
        Some(pty_in_tx.clone()),
    ) {
        let json = serde_json::to_string(&err).unwrap_or_default();
        let _ = ws_tx.send(Message::Text(json)).await;
        return;
    }

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let read_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = buf[..n].to_vec();
                    if out_tx.send(chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let write_task = tokio::task::spawn_blocking(move || {
        let mut writer = writer;
        loop {
            while let Ok((cols, rows)) = resize_rx.try_recv() {
                let _ = master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
            match pty_in_rx.blocking_recv() {
                Some(bytes) => {
                    if writer.write_all(&bytes).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                None => break,
            }
        }
    });

    let hub_unreg = hub.clone();
    let name_unreg = name.clone();

    loop {
        tokio::select! {
            Some(chunk) = out_rx.recv() => {
                if ws_tx.send(Message::Binary(chunk)).await.is_err() {
                    break;
                }
            }
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        let _ = pty_in_tx.send(data);
                    }
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(resize) = serde_json::from_str::<ResizeMsg>(&text) {
                            if resize.kind == "resize" {
                                let _ = resize_tx.send((resize.cols, resize.rows));
                            }
                        } else {
                            let _ = pty_in_tx.send(text.into_bytes());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    hub_unreg.unregister(&name_unreg);
    let _ = read_task.await;
    let _ = write_task.await;
    let _ = ws_tx
        .send(Message::Text(serde_json::json!({"type":"exit"}).to_string()))
        .await;
}

#[cfg(test)]
mod tests {
    use super::agent_launch_script;

    #[test]
    fn shell_preset_is_interactive() {
        let script = agent_launch_script("bash");
        assert!(script.contains(" -i"));
        assert!(!script.contains("command -v"));
    }

    #[test]
    fn agent_preset_falls_back_to_shell() {
        let script = agent_launch_script("codex");
        assert!(script.contains("'codex'"));
        assert!(script.contains("exec") && script.contains(" -i"));
    }
}
