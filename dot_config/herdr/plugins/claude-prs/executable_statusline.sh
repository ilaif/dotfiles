#!/usr/bin/env bash
# ccstatusline custom-command widget: the session's PRs as clickable OSC 8 links, colored by state.
set -euo pipefail
# ccstatusline kills the widget after 1s; process spawns here cost 40-100ms each, and the mise jq shim ~0.3s.
deadline=$((${EPOCHREALTIME/./} + 700000))
PATH="/opt/homebrew/bin:$PATH"
IFS= read -r -d '' input || true
[[ "$input" =~ \"session_id\":\ *\"([^\"]+)\" ]]
session_id="${BASH_REMATCH[1]}"
state_dir="${CLAUDE_PRS_STATE_DIR:-$HOME/.local/state/claude-prs}"
f="$state_dir/$session_id.json"
cache="$state_dir/$session_id.statusline"
[[ -f "$f" ]] || exit 0
# Render into the cache in the background; past the deadline, show the previous line instead of [Timeout].
(
  # The hook only refreshes PR states when a turn ends; refresh in the background once they are a minute old.
  if jq -e '(.refreshed_ms // 0) < (now * 1000 - 60000)' "$f" >/dev/null; then
    jq -c '{hook_event_name: "Stop", session_id, cwd}' "$f" | nohup sh "$(dirname "$0")/hook.sh" --run >/dev/null 2>&1 &
  fi
  jq -j -L "$(dirname "$0")" 'include "review";
    def rgb: {OPEN: "80;250;123", DRAFT: "98;114;164", MERGED: "189;147;249", CLOSED: "255;85;85"}[.state // ""] // "248;248;242";
    [.prs[] | select(.state != "MERGED" and .state != "CLOSED") | "\(.review | review_badge)\u001b[38;2;\(rgb)m\u001b]8;;\(.url)\u001b\\\(.repo)#\(.number)\u001b]8;;\u001b\\\u001b[0m"] | join(" ")' "$f" >"$cache.tmp"
  mv "$cache.tmp" "$cache"
) >/dev/null 2>&1 &
render=$!
while kill -0 "$render" 2>/dev/null && ((${EPOCHREALTIME/./} < deadline)); do
  sleep 0.05
done
[[ -f "$cache" ]] && cat "$cache"
exit 0
