#!/usr/bin/env bash
set -euo pipefail
herdr="${HERDR_BIN_PATH:-herdr}"
state_dir="${HERDR_CLAUDE_RECAP_STATE_DIR:-$HOME/.local/state/herdr-claude-recap}"
target="${RECAP_TARGET_PANE:-}"

agents="$("$herdr" agent list | jq -c --arg t "$target" '
  .result.agents
  | map(. + {is_target: (.pane_id == $t), is_claude: (.agent == "claude")})
  | sort_by((if .is_target then 0 else 1 end), (if .is_claude then 0 else 1 end), .workspace_id, .tab_id)')"

ws_names="$("$herdr" workspace list | jq -c '[.result.workspaces[] | {key: .workspace_id, value: (.label // .name)}] | from_entries')"
tab_names="$("$herdr" tab list 2>/dev/null | jq -c '[.result.tabs[]? | {key: .tab_id, value: (.label // .name)}] | from_entries' || echo '{}')"

md="$(jq -r --argjson ws "$ws_names" --argjson tabs "$tab_names" --arg dir "$state_dir" '
  def icon: {working: "●", blocked: "◉", done: "✔", idle: "○"}[.agent_status] // "?";
  .[] |
  "## \(icon) \($ws[.workspace_id] // .workspace_id) › \($tabs[.tab_id] // .tab_id) — \(.agent) (\(.agent_status))\(if .is_target then "  ← focused" else "" end)\n" +
  "`\(.pane_id)` · \(.cwd)\n\n" +
  "@@RECAP:\(.pane_id | gsub(":"; "_"))@@\n"
' <<<"$agents")"

render() {
  while IFS= read -r line; do
    if [[ "$line" =~ ^@@RECAP:(.+)@@$ ]]; then
      f="$state_dir/${BASH_REMATCH[1]}.json"
      if [[ -f "$f" ]]; then
        jq -r '"_\((.updated_ms / 1000 | localtime | strftime("%H:%M")))_\n\n" + .recap' "$f"
      else
        echo "_no recap yet_"
      fi
      echo
    else
      printf '%s\n' "$line"
    fi
  done <<<"$md"
}

{
  echo "# Claude recaps"
  echo
  if [[ -z "$agents" || "$agents" == "[]" ]]; then echo "_no agents running_"; else render; fi
} > "${TMPDIR:-/tmp}/herdr-claude-recap.md"

if command -v glow >/dev/null 2>&1; then
  glow -p -w "$(( ${COLUMNS:-100} - 4 ))" "${TMPDIR:-/tmp}/herdr-claude-recap.md"
else
  ${PAGER:-less -R} "${TMPDIR:-/tmp}/herdr-claude-recap.md"
fi
