# Notepad como Memória Viva — Design

## Context

No canvas do AgentHub, terminais (agentes Claude Code) já trocam mensagens via `agenthub-cli ask`,
validado por edges terminal↔terminal no hub. O usuário quer que um agente escreva num widget
**Notepad** conectado ao seu terminal — uma "memória viva" onde o agente persiste descobertas
e estado.

Dois gaps no código atual:
1. **Widgets não podem ser conectados.** Edges existem só entre terminais (por nome, no hub).
   `completeLink` só resolve `nodes`; CanvasWidget não tem porta; `Hub::connect` exige ambos
   registrados como agentes. A linha tracejada terminal→notepad é apenas o *drafting* do cursor.
2. **Não há canal para escrever no notepad.** O CLI fala HTTP (`POST /msg`), o hub roteia e a UI
   é dona do estado dos widgets.

## Approach

Edge terminal↔notepad é **frontend-only** (widget não é agente no hub). Escrita flui via novo
endpoint HTTP → hub faz broadcast → a UI resolve o notepad alvo e aplica.

### Protocolo (Rust)
- `ServerMessage::WidgetUpdate { from, to: Option<String>, content, mode }` — broadcast hub→UI.
  Tag serde `widget_update`. **Não** vai pro `event_log` (evita re-aplicar append em reconexão).

### Backend
- `routes.rs`: `POST /note` com `NoteBody { from, to: Option<String>, content, mode (default "append") }`
  → `hub.route_note(...)`.
- `hub.rs`: `route_note(from, to, content, mode)` — valida `from` registrado; normaliza mode
  para `append|replace`; faz broadcast de `WidgetUpdate`. Sem validação de edge (hub não conhece
  widgets; a UI valida pela edge frontend).
- `sessions.rs`: `SessionSnapshot.widget_edges: Vec<[String;2]>` (`#[serde(rename="widgetEdges")]`),
  pares `[nodeId, widgetId]`. `get_sessions` inclui `widgetEdges`.
- `agenthub-cli.rs`: subcomando `note [--to <title>] [--append|--replace] <conteúdo...>` → `POST /note`.

### Frontend
- `hub.ts`: `HubWidgetUpdate { type:"widget_update", from, to?, content, mode }` no `HubEvent`.
- `sessions.ts`: `SessionSnapshot.widgetEdges?: [string,string][]`.
- `AgentCanvas.tsx`:
  - Estado `widgetEdges: [nodeId, widgetId][]`; carrega/salva na sessão; limpa em removeNode/removeWidget.
  - `completeLink`: se alvo é widget e origem é node → cria widget-edge (sem hub). Drop já detecta
    widget via `data-node-id` existente no CanvasWidget.
  - Render SVG das widget-edges (node out-port → widget in-port).
  - Handler `widget_update`: resolve alvo — se `to` setado, por `title`; senão pelo nó `from`→edge.
    Aplica `append` (concatena com `\n`) ou `replace`. Usa refs (`nodesRef`, `widgetEdgesRef`) por
    causa do closure de efeito com deps vazias.
- `CanvasWidget.tsx`: porta de entrada (dot esquerdo), realça durante link (`linking` prop).
- `App.css`: estilos `.widget-port`, `.edge-cable.widget-edge`.
- `vite.config.ts`: proxy `/note`.

### Skill
- `skills/agenthub/SKILL.md`: seção Notepad documentando `agenthub-cli note`.

## Targeting (resposta C+C do brainstorm)
- **Mode:** `append` (padrão, log de memória) ou `replace` (snapshot). Convenção via flag.
- **Alvo:** edge auto-discover primeiro (`note` sem `--to`); fallback por título (`--to "Notepad"`).

## Limitação conhecida
WidgetUpdate é transiente (broadcast-only). Sem UI aberta, a nota é perdida — coerente com o
modelo atual (frontend é dono do estado do canvas).

## Verification
- `cargo build` limpo.
- `npm run build` / `vitest` na UI.
- E2E manual: abrir canvas, criar terminal + notepad, arrastar cabo terminal→notepad,
  rodar `agenthub-cli note "linha 1"` no terminal → aparece no notepad; `--replace` sobrescreve;
  `--to "Notepad"` mira por título.
