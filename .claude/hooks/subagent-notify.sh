#!/bin/bash
# Notifies AgentHub when a subagent starts or finishes.
# Called by PreToolUse (SUBAGENT_STATUS=running) and PostToolUse (SUBAGENT_STATUS=done).
INPUT=$(cat)
TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // ""')
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // "Subagent"')
STATUS="${SUBAGENT_STATUS:-running}"
PORT="${AGENTHUB_PORT:-3000}"

[ -z "$TOOL_USE_ID" ] && exit 0

jq -n --arg id "$TOOL_USE_ID" --arg label "$DESCRIPTION" --arg status "$STATUS" \
  '{id: $id, label: $label, status: $status}' | \
curl -s -X POST "http://localhost:${PORT}/subagents" \
  -H "Content-Type: application/json" \
  -d @- > /dev/null 2>&1

exit 0
