---
name: agenthub
description: Send messages between linked AI agents in AgentHub (like Maestri). Use when terminals are connected on the canvas and the user wants agents to coordinate via agenthub-cli ask, not raw terminal piping.
---

# AgentHub skill

AgentHub links terminals on a canvas. **A link does not auto-forward output.** Agents talk only when you run `agenthub-cli`.

## When to use

- User connected two+ terminals in AgentHub UI
- User wants agent A to ask agent B something
- User mentions AgentHub, linked agents, or cross-agent handoff

## Commands (run in Bash)

```bash
# Who is connected?
agenthub-cli list

# Who can I message from this terminal?
agenthub-cli peers

# Send a task and WAIT for reply (blocks until child calls reply)
agenthub-cli ask terminal-2 "Review src/main.rs and suggest fixes"
# → prints the reply when terminal-2 responds
# → times out after 5 minutes with error

# Reply to a parent waiting on you
agenthub-cli reply terminal-1 "done: found 3 issues, fixed 2"
```

`AGENTHUB_NAME` is set automatically inside UI terminals. Outside UI, export it to match the terminal name shown in the canvas.

## Workflow (Maestri-style)

### Single parent → child
1. Parent confirms link: `agenthub-cli peers`
2. Parent sends task: `agenthub-cli ask <child> "<task>"` — **blocks**
3. Child sees `[parent-name]: <task>` injected in terminal, executes task
4. Child signals done: `agenthub-cli reply <parent> "<result>"`
5. Parent's `ask` unblocks and prints the result

### Multi-child orchestration
Parent sends tasks to multiple children, each in a background subshell:
```bash
result_a=$(agenthub-cli ask agent-a "analyze auth module") &
result_b=$(agenthub-cli ask agent-b "analyze data module") &
wait
echo "a: $result_a"
echo "b: $result_b"
```
Children orchestrate among themselves the same way — any agent can `ask` any linked peer and `reply` to unblock them.

### Child responsibility
When a message arrives, always end execution with:
```bash
agenthub-cli reply <sender> "<summary of what was done>"
```
Without a reply, the parent times out after 5 minutes.

4. Do **not** paste the other agent's live stdout — use `ask`/`reply` only when the user requests coordination

## Style

- After sending, do not narrate "Message sent, X will do Y." — just confirm sent or be silent.
- No announcements before using the skill. Just run the commands.

## Install skill (Claude Code)

This repo ships the skill at `skills/agenthub/`. Claude Code loads project skills from `.claude/skills/`:

```bash
mkdir -p .claude/skills
ln -sf ../../skills/agenthub .claude/skills/agenthub
```

(Already linked when you clone this repo.)

## Claude Code permissions

Add to project or user settings:

```json
{
  "permissions": {
    "allow": ["Bash(agenthub-cli:*)"]
  }
}
```

## Cursor / other agents

Install CLI on PATH (built with `./run.sh`). Same commands.

## Notepad (memória viva)

Conecte um terminal a um widget Notepad no canvas arrastando o cabo de saída do terminal (●) para o notepad. O notepad funciona como memória persistente do agente.

```bash
# Escreve ao notepad conectado (append, padrão)
agenthub-cli note "descoberta: a função foo tem bug na linha 42"

# Substitui o conteúdo inteiro (snapshot)
agenthub-cli note --replace "estado atual: implementando feature X"

# Mira por título em vez de edge (fallback)
agenthub-cli note --to "Research Notes" "ref: RFC 7234 seção 3"
```

**Resolução do alvo:**
1. `--to <título>` → busca widget por título
2. Sem `--to` → auto-descobre via edge terminal→notepad no canvas

**Modos:** `append` (padrão, log) | `replace` (snapshot, sobrescreve)

## Troubleshooting

| Error | Fix |
|-------|-----|
| `no edge between agents` | Link terminals in canvas (drag ●) |
| `agent not connected` | Target terminal closed — reopen in UI |
| `AGENTHUB_NAME not set` | Not an AgentHub terminal |
| `no pending request from that agent` | `reply` called but no `ask` waiting; check sender name |
| `timeout: no reply within 5 minutes` | Child never called `reply` — add it to child workflow |

Hub URL: `AGENTHUB_URL` or `http://127.0.0.1:3000`
