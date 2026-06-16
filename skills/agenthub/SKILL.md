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

# Send a message (target must be linked in UI)
agenthub-cli ask terminal-2 "Review src/main.rs and suggest fixes"
```

`AGENTHUB_NAME` is set automatically inside UI terminals. Outside UI, export it to match the terminal name shown in the canvas.

## Workflow (Maestri-style)

1. Confirm link exists: `agenthub-cli peers`
2. Send explicit prompt: `agenthub-cli ask <peer> "<task>"`
3. Peer sees message injected into its terminal as: `[from-name]: <task>`
4. Do **not** paste the other agent's live stdout — use `ask` only when the user requests coordination

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

## Troubleshooting

| Error | Fix |
|-------|-----|
| `no edge between agents` | Link terminals in canvas (drag ●) |
| `agent not connected` | Target terminal closed — reopen in UI |
| `AGENTHUB_NAME not set` | Not an AgentHub terminal |

Hub URL: `AGENTHUB_URL` or `http://127.0.0.1:3000`
