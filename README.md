# AgentHub

Local hub to connect independent AI agents on demand, with an integrated
file/doc viewer in the browser.

## Slice 1 — Doc Viewer (current)

Run:

    cd ui && npm install && npm run build && cd ..
    AGENTHUB_WORKSPACE=. cargo run

Open http://127.0.0.1:3000 and browse the workspace.

Config: `AGENTHUB_WORKSPACE` (root to serve, default `.`),
`AGENTHUB_UI_DIR` (built UI, default `ui/dist`), `AGENTHUB_PORT` (default 3000).

Next slices: WebSocket agent messaging, node-graph UI, MCP + terminal adapters.
