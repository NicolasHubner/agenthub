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
| Drag-and-drop node graph | 🔜 |
| MCP adapter (Claude Code) | 🔜 |
| Terminal wrapper improvements | 🔜 |

## Quick start

### Prerequisites

- [Rust](https://rustup.rs/) (2021 edition)
- [Node.js](https://nodejs.org/) 18+ and npm

### 1. Build and run the hub

```bash
cd ui && npm install && npm run build && cd ..
AGENTHUB_WORKSPACE=. cargo run
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The **Agents** tab is the main view; **Files** is the doc viewer.

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
```

## Roadmap

1. ~~Doc viewer~~ ✅
2. ~~WebSocket hub + agent registry~~ ✅
3. ~~UI agent panel + manual linking~~ ✅
4. Node graph (drag-to-connect) 🔜
5. MCP adapter for Claude Code 🔜

**Non-goals:** remote access, authentication, durable storage, automatic orchestration, in-browser file editing.

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first.

1. Fork the repo
2. `git checkout -b feat/my-change`
3. `cargo test` and `cd ui && npm test`
4. Open a PR with a clear description

## License

[MIT](LICENSE) — Copyright (c) 2026 Nicolas Hubner
