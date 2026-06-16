# AgentHub — Design

**Data:** 2026-06-16
**Status:** Aprovado (brainstorming)

## Problema

Rodo múltiplos agents de IA ao mesmo tempo (Claude Code, Cursor agents, Codex, terminal puro). Hoje rodam isolados; quando quero que dois conversem ou coordenem, não há canal. Não quero acoplá-los permanentemente — quero conectá-los **sob demanda**, via interface gráfica (arrastar/ligar com mouse), no estilo do Maestri, porém mais simples.

## Objetivo

Hub local (mesma máquina) que:
- Cada agent roda **independente**, em seu próprio processo.
- Agent conecta ao hub quando quiser; desconecta quando quiser.
- UI web (browser, localhost) mostra agents conectados como **nós** num grafo; usuário liga dois nós para abrir canal de mensagens entre eles.
- **Viewer de arquivos integrado** na mesma UI: painel com árvore de arquivos clicável + pane que renderiza markdown e código (syntax highlight). Resolve "não consigo ver docs no tmux" sem ferramenta externa. Uma solução só, open source.
- Rápido e leve (Rust).

## Não-objetivos (YAGNI)

- Sem máquinas remotas / rede pública (só localhost).
- Sem autenticação / multiusuário.
- Sem persistência durável (event log em memória; histórico some ao reiniciar o hub).
- Sem orquestração automática / DAG de workflow. Conexão é manual, feita pelo usuário.
- Sem suporte a agents que não falem o protocolo (cada tipo precisa de um adapter).
- Viewer é **read-only** no MVP. Editar arquivos no browser fica para depois.
- Viewer enxerga só a pasta-raiz do projeto (workspace). Sem navegar o filesystem inteiro.

## Arquitetura

Processo único em Rust = **AgentHub**.

```
┌─────────────────────────────────────────────┐
│                 AgentHub (Rust)              │
│                                              │
│  HTTP :3000 ──► serve Web UI (React build)   │
│            ├──► REST: GET /state             │
│            ├──► REST: GET /files (árvore)    │
│            └──► REST: GET /file?path= (conteúdo)│
│                                              │
│  WebSocket :3001 ──► canal dos agents        │
│                      e do browser (UI)       │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐  │
│  │Registry │  │ Broker   │  │ Event log   │  │
│  │(dashmap)│  │(fila/    │  │(ring buffer │  │
│  │agents   │  │ agent)   │  │ em memória) │  │
│  └─────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────┘
        ▲           ▲            ▲
        │ WS        │ WS         │ WS
   ┌────┴───┐  ┌────┴────┐  ┌────┴────┐
   │claude  │  │ terminal│  │ browser │
   │via MCP │  │ wrapper │  │  (UI)   │
   └────────┘  └─────────┘  └─────────┘
```

### Componentes

**Registry** — `DashMap<AgentId, AgentInfo>`. Quem está conectado agora. `AgentInfo`: nome, tags, sender do canal, timestamp de conexão. Conexão WS abre → registra; WS cai → remove.

**Broker** — uma fila (mpsc) por agent conectado. Mensagem destinada a um agent vai para a fila dele; a task da conexão WS daquele agent drena a fila e escreve no socket. Se agent destino offline → mensagem descartada + erro de volta ao remetente (sem store-and-forward no MVP).

**Event log** — ring buffer em memória (ex.: últimas N=1000 mensagens). Alimenta a UI quando o browser abre (mostra histórico recente) e serve `GET /state`.

**Edges (conexões)** — o hub guarda o conjunto de pares conectados (`HashSet<(AgentId, AgentId)>`). Uma `msg` de A para B só é entregue se existir edge A–B **ou** se for `broadcast`. Editar edges = criar/remover conexão pela UI. É isso que dá o "conecto quando quiser".

**File service** — serve a árvore e o conteúdo de arquivos da pasta-raiz do workspace (read-only). `GET /files` → árvore de paths. `GET /file?path=` → conteúdo bruto. A UI renderiza markdown/código. Caminho é resolvido e validado contra a raiz canônica do workspace; qualquer path que escape a raiz (`..`, symlink, path absoluto) é rejeitado com 403. Sem isso, o endpoint vira leitura arbitrária do filesystem.

### Fluxo de dados

1. Agent sobe (independente) e abre WS para `:3001`, manda `register`.
2. Hub registra no Registry, faz broadcast de `state` para a UI.
3. Usuário no browser vê o nó novo; arrasta uma aresta de A para B → UI manda `connect {a,b}` → hub adiciona edge.
4. Agent A manda `msg {to:B, content}` → hub checa edge A–B → enfileira no Broker de B → task de B entrega.
5. UI recebe cópia de toda mensagem (observabilidade) via event log / broadcast.

## Protocolo (JSON sobre WebSocket)

Agent → Hub:
```json
{"type":"register","name":"claude-1","tags":["claude"]}
{"type":"msg","to":"cursor-1","content":"revisa esse arquivo"}
{"type":"broadcast","content":"terminei a feature"}
```

Hub → Agent / UI:
```json
{"type":"state","agents":[{"name":"claude-1","connected":true,"tags":["claude"]}],"edges":[["claude-1","cursor-1"]]}
{"type":"msg","from":"cursor-1","content":"ok, revisado"}
{"type":"error","reason":"agent offline","to":"cursor-1"}
```

UI → Hub (controle):
```json
{"type":"connect","a":"claude-1","b":"cursor-1"}
{"type":"disconnect","a":"claude-1","b":"cursor-1"}
```

Regras:
- `name` único. Registrar nome já em uso → `error`, conexão recusada.
- `msg` exige edge ou vira `error`. `broadcast` ignora edges (vai para todos).
- Mensagem desconhecida → `error`, conexão mantida.

## Adapters (um por tipo de agent)

| Tipo | Adapter |
|------|---------|
| Claude Code | MCP server local. Tools: `list_agents`, `send_message(to, content)`, `read_messages()`. O MCP server é um cliente WS do hub. |
| Terminal puro | Script wrapper `agenthub connect <nome> -- <cmd>`. Faz bridge stdin/stdout ↔ WS. |
| Cursor / Codex CLI | Mesmo wrapper, ou cliente WS de ~10 linhas. |
| Custom | SDK mínimo (abrir WS, `register`, mandar/receber JSON). |

MVP entrega: **hub + UI + MCP server (Claude) + wrapper de terminal**. Cursor/Codex/SDK ficam para depois (mesmo protocolo, custo baixo).

## Stack técnico

**Hub (Rust):**
- `tokio` — runtime async.
- `axum` — HTTP (serve UI + REST).
- `tokio-tungstenite` — WebSocket.
- `serde` / `serde_json` — protocolo.
- `dashmap` — Registry concorrente.

**UI (web):**
- `Vite` + `React`.
- `React Flow` — grafo de nós drag-and-drop.
- `react-markdown` — render de markdown no viewer.
- `shiki` (ou Prism) — syntax highlight de código no viewer.
- Layout: aba/painel "Grafo" + aba/painel "Arquivos" (árvore clicável + pane de conteúdo).
- Build estático servido pelo axum em `:3000`.

**MCP server (Claude adapter):**
- Rust ou TS (a definir no plano). Cliente WS do hub expondo as 3 tools.

## Tratamento de erros

- Agent destino offline → `error` ao remetente; mensagem descartada (sem retry no MVP).
- Nome duplicado no `register` → conexão recusada com `error`.
- WS cai → Registry remove agent, broadcast de `state`, edges daquele agent removidas.
- JSON inválido / tipo desconhecido → `error`, conexão segue viva.
- Hub reinicia → tudo em memória se perde; agents precisam reconectar.
- `GET /file` com path fora da raiz do workspace (`..`, symlink, absoluto) → 403, nada é lido.
- `GET /file` em arquivo inexistente → 404. Arquivo binário/grande demais → 415/413 (não tenta renderizar).

## Testes

- Unit: parsing do protocolo (serde round-trip), regras de edge (msg sem edge → error), Registry add/remove.
- Unit: resolução de path do file service — rejeita `..`, symlink e path absoluto; aceita arquivo dentro da raiz.
- Integração: subir hub, conectar 2 clientes WS fake, criar edge, mandar msg, assertar entrega; testar offline → error; testar broadcast.
- Integração: `GET /files` lista a árvore; `GET /file?path=` devolve conteúdo; path traversal → 403.
- Manual: abrir UI, conectar Claude via MCP + um terminal, ligar os nós, trocar mensagem; abrir aba Arquivos, clicar no spec, ver markdown renderizado.

## Fases sugeridas

1. Hub core: WS server, Registry, Broker, protocolo, edges. Testável com clientes fake.
2. REST `/state` + file service (`/files`, `/file` com guard de path) + servir UI estática.
3. UI: viewer de arquivos (árvore clicável + render markdown/código). **Entrega cedo o "ver docs no browser".**
4. UI React Flow: render nós do `state`, criar/remover edges, log de mensagens.
5. MCP server (adapter Claude).
6. Wrapper de terminal.
7. (Depois) Cursor/Codex/SDK; editar arquivo no browser.
