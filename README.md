# AgentHub

**Connect independent AI agents on demand — locally, in your browser.**

AgentHub is a lightweight localhost hub for running multiple AI agents (Claude Code, Cursor, Codex, terminal tools) in parallel without permanent coupling. Agents join when they want, leave when they want, and you wire them together from a web UI only when coordination is needed.

Also includes a **read-only workspace viewer** for markdown and code — so you can read docs without juggling tmux panes.

| | |
|---|---|
| **Stack** | Rust (Axum) + React (Vite) |
| **Scope** | Localhost only — no cloud, no accounts |
| **License** | [MIT](LICENSE) |

## Why AgentHub?

Running several agents at once usually means isolated terminals. When two agents need to talk, you copy-paste context or write glue scripts. Reading project docs from tmux is painful.

AgentHub gives you one process on your machine that:

- **Registers agents** over WebSocket as they connect and disconnect
- **Links agents on demand** — create a channel between two agents from the UI; tear it down when done
- **Routes messages** only across active links (or broadcast with `*`)
- **Browses your workspace** — file tree + markdown/code viewer in the same UI

Inspired by tools like [Maestri](https://maestri.ai), but deliberately simpler: manual connections, no workflow DSL, no orchestration engine.

## Features

| Feature | Status |
|---------|--------|
| WebSocket hub + agent registry | ✅ |
| Message broker with connection edges | ✅ |
| Web UI — agent panel, link agents, live log | ✅ |
| `agenthub-connect` terminal CLI | ✅ |
| Workspace file tree + doc viewer | ✅ |
| Path traversal protection on file API | ✅ |
| Native desktop app (Tauri) + one-line installer | ✅ |
| Installable PWA (browser → desktop, all OS) | ✅ |
| Canvas: terminal nodes, pan/zoom-to-cursor, group boxes | ✅ |
| tmux-style keyboard shortcuts | ✅ |
| MCP adapter (Claude Code) | 🔜 |
| Terminal wrapper improvements | 🔜 |

## Install (desktop app)

Fastest path — no toolchain needed. Debian/Ubuntu, one line:

```bash
curl -fsSL https://raw.githubusercontent.com/NicolasHubner/agenthub/main/install.sh | bash
```

It pulls the latest `.deb` from [Releases](https://github.com/NicolasHubner/agenthub/releases), installs `tmux` + WebKit runtime deps, and adds **AgentHub** to your app menu.

On other distros (or to avoid apt), grab the portable **`.AppImage`** from the same Releases page — `chmod +x` and run it.

The desktop app is built with [Tauri](https://tauri.app): a native window wrapping the React UI, with the Rust backend bundled as a sidecar (no separate server to start).

## Quick start (from source)

### Prerequisites

You need three things installed: **Rust** (cargo), **Node.js 18+** (npm), and **git**.

Copy-paste for your OS:

```bash
# Linux (Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y git curl build-essential
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

```bash
# macOS (Homebrew)
brew install git node rustup-init && rustup-init -y
```

```powershell
# Windows (winget)
winget install Git.Git OpenJS.NodeJS Rustlang.Rustup
```

After installing, restart your shell so `cargo` and `node` are on PATH. Verify:

```bash
cargo --version && node --version && npm --version && git --version
```

### Easiest: one command (Linux / macOS / Windows)

The launcher builds the UI + backend if needed, starts the server, and opens your browser.

```bash
# Linux / macOS
./scripts/agenthub-start.sh
```

```powershell
# Windows (PowerShell)
./scripts/agenthub-start.ps1
```

On Windows you can also **double-click** `scripts\agenthub-start.cmd`.

Then in the browser, click the **install icon** in the address bar (Chrome/Edge) to install AgentHub as a **desktop app (PWA)** — it opens in its own window and works on Linux, macOS, and Windows. The Rust backend must be running for terminals to work; the launcher above keeps it running.

> Prefer a packaged download? See [Install (desktop app)](#install-desktop-app) above. Maintainers cut a release with `./release.sh [version]` — it runs `./desktop.sh` to build the Tauri bundles (`.deb` + `.AppImage`) and publishes/updates the matching GitHub Release.

### Manual: build and run the hub

```bash
cd ui && npm install && npm run build && cd ..
AGENTHUB_WORKSPACE=. cargo run
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The **Agents** tab is the main view; **Files** is the doc viewer.

### Keyboard shortcuts (tmux-style)

On the canvas, press the prefix **`Ctrl-b`**, then a command key:

| Key | Action |
|-----|--------|
| `c` | New terminal |
| `x` | Close focused terminal |
| `n` / `p` | Cycle to next / previous terminal |
| `←` `↑` `↓` `→` | Move focus to the terminal in that direction |
| `z` | Zoom (center + fit) the focused terminal |
| `0`–`9` | Jump to terminal N |

Other canvas controls: **Space + drag** to pan, **Alt + scroll** to zoom.

### 2. Connect agents from separate terminals

With the hub running:

```bash
# Terminal 1 — first agent
cargo run --bin agenthub-connect -- --name claude --tag claude

# Terminal 2 — second agent (default send target: claude)
cargo run --bin agenthub-connect -- --name cursor --tag cursor --to claude
```

In the browser: select **claude** and **cursor** → click **Connect**. Type in either terminal; messages flow only when the link exists.

Use `--to '*'` to broadcast to every connected agent (no edge required).

### 3. Build the CLI once (optional)

```bash
cargo install --path . --bin agenthub-connect
agenthub-connect --name my-agent --tag terminal
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTHUB_WORKSPACE` | `.` | Workspace root for the read-only file viewer |
| `AGENTHUB_UI_DIR` | `ui/dist` | Path to the built frontend |
| `AGENTHUB_PORT` | `3000` | HTTP listen port (binds `127.0.0.1` only) |

HTTP and WebSocket share the same port. WebSocket endpoint: `ws://127.0.0.1:3000/ws`.

### `agenthub-connect` flags

| Flag | Description |
|------|-------------|
| `--name`, `-n` | Agent display name (default: `agent`) |
| `--hub`, `-u` | Hub WebSocket URL (default: `ws://127.0.0.1:3000/ws`) |
| `--to`, `-t` | Default recipient for stdin lines (default: `*` = broadcast) |
| `--tag` | Tag label (repeatable) |

Stdin lines become hub messages; incoming messages print to stdout as `[from] content`.

## WebSocket protocol

JSON messages over `/ws`. All client messages use a `type` field.

### Client → hub

```jsonc
{ "type": "register", "name": "claude", "tags": ["claude"] }
{ "type": "subscribe" }
{ "type": "msg", "to": "cursor", "content": "hello" }
{ "type": "connect", "a": "claude", "b": "cursor" }
{ "type": "disconnect", "a": "claude", "b": "cursor" }
```

- **`register`** — join the hub as an agent (required for message delivery).
- **`subscribe`** — UI clients only; receive state updates and message log.
- **`msg`** — send to `to` (agent name or `*` for broadcast). Delivered only if an edge exists (except broadcast).
- **`connect` / `disconnect`** — add or remove a bidirectional link between two agents.

### Hub → client

```jsonc
{ "type": "state", "agents": [...], "edges": [["a","b"]] }
{ "type": "msg", "from": "claude", "to": "cursor", "content": "hello" }
{ "type": "error", "reason": "no route to agent", "to": "cursor" }
```

`GET /state` returns the same snapshot as the latest `state` event (REST fallback).

## HTTP API (files)

Read-only, scoped to `AGENTHUB_WORKSPACE`.

| Endpoint | Description |
|----------|-------------|
| `GET /state` | Current agents and edges |
| `GET /files` | Sorted list of relative file paths |
| `GET /file?path=<rel>` | File content + metadata (`kind`: `markdown`, `code`, `text`) |

Files over 2 MiB or non–UTF-8 content are rejected. Paths escaping the workspace root (`..`, symlinks, absolute paths) return `403`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  AgentHub (Rust)                  │
│                                                   │
│  :3000  HTTP  ──► React UI (static)              │
│              ├──► GET /state, /files, /file       │
│              └──► WS  /ws  (agents + browser)     │
│                                                   │
│  Registry ── agents online (DashMap)              │
│  Broker   ── per-agent delivery queues            │
│  Edges    ── manual links between agent pairs     │
│  Event log── ring buffer (last 1000 messages)     │
└──────────────────────────────────────────────────┘
         ▲              ▲                ▲
         │ WS           │ WS             │ browser
    agenthub-connect  agenthub-connect   (UI)
```

| Path | Role |
|------|------|
| `src/main.rs` | Server entrypoint |
| `src/hub.rs` | WebSocket hub, registry, broker, edges |
| `src/protocol.rs` | JSON message types |
| `src/workspace.rs` | Safe file listing and reading |
| `src/bin/connect.rs` | Terminal agent CLI |
| `ui/` | React frontend |

Full design spec: [`docs/superpowers/specs/2026-06-16-agenthub-design.md`](docs/superpowers/specs/2026-06-16-agenthub-design.md).

## Development

```bash
# Backend tests
cargo test

# Frontend (separate terminal; hub must be running for API)
cd ui && npm install
npm run dev    # Vite on :5173, proxies /files and /file
npm test
npm run build  # → ui/dist

# Desktop app bundle (needs the Tauri CLI: cargo install tauri-cli)
./desktop.sh   # builds backend + UI, then .deb + .AppImage into src-tauri/target/release/bundle
```

## Roadmap

1. ~~Doc viewer~~ ✅
2. ~~WebSocket hub + agent registry~~ ✅
3. ~~UI agent panel + manual linking~~ ✅
4. ~~Canvas: terminal nodes, pan/zoom, group boxes~~ ✅
5. ~~Native desktop app + one-line installer~~ ✅
6. Node graph drag-to-connect edges 🔜
7. MCP adapter for Claude Code 🔜

**Non-goals:** remote access, authentication, durable storage, automatic orchestration, in-browser file editing.

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first.

1. Fork the repo
2. `git checkout -b feat/my-change`
3. `cargo test` and `cd ui && npm test`
4. Open a PR with a clear description

## License

[MIT](LICENSE) — Copyright (c) 2026 Nicolas Hubner
