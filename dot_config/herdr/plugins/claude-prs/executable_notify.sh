#!/bin/sh
# Claude Code hook (PostToolUse, UserPromptSubmit): hands the model the PR changes hook.sh's refresh queued, as
# additionalContext, so it learns of them at its next tool call or prompt without a turn being started.
set -eu
STATE_DIR="${CLAUDE_PRS_STATE_DIR:-$HOME/.local/state/claude-prs}"
input="$(cat)"
session_id="$(printf '%s' "$input" | sed -nE 's/.*"session_id": *"([^"]+)".*/\1/p' | head -1)"
f="$STATE_DIR/$session_id.notify"
[ -s "$f" ] || exit 0
mv "$f" "$f.$$"
event="$(printf '%s' "$input" | sed -nE 's/.*"hook_event_name": *"([^"]+)".*/\1/p' | head -1)"
jq -n --rawfile t "$f.$$" --arg e "$event" \
  '{hookSpecificOutput: {hookEventName: $e, additionalContext: "PR status changed (claude-prs; informational, no action requested):\n\($t)"}}'
rm -f "$f.$$"
