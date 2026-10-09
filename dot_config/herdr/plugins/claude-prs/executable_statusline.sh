#!/usr/bin/env bash
# ccstatusline custom-command widget: the session's PRs as clickable OSC 8 links, colored by state.
set -euo pipefail
session_id="$(jq -r .session_id)"
f="${CLAUDE_PRS_STATE_DIR:-$HOME/.local/state/claude-prs}/$session_id.json"
[[ -f "$f" ]] || exit 0
# The hook only refreshes PR states when a turn ends; refresh in the background once they are a minute old.
if jq -e '(.refreshed_ms // 0) < (now * 1000 - 60000)' "$f" >/dev/null; then
  jq -c '{hook_event_name: "Stop", session_id, cwd}' "$f" | nohup sh "$(dirname "$0")/hook.sh" --run >/dev/null 2>&1 &
fi
jq -j -L "$(dirname "$0")" 'include "review";
  def rgb: {OPEN: "80;250;123", DRAFT: "98;114;164", MERGED: "189;147;249", CLOSED: "255;85;85"}[.state // ""] // "248;248;242";
  [.prs[] | select(.state != "MERGED" and .state != "CLOSED") | "\(.review | review_badge)\u001b[38;2;\(rgb)m\u001b]8;;\(.url)\u001b\\\(.repo)#\(.number)\u001b]8;;\u001b\\\u001b[0m"] | join(" ")' "$f"
