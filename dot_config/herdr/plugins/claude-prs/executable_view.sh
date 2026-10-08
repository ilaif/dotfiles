#!/usr/bin/env bash
set -euo pipefail
herdr="${HERDR_BIN_PATH:-herdr}"
state_dir="${CLAUDE_PRS_STATE_DIR:-$HOME/.local/state/claude-prs}"
target="${PRS_TARGET_PANE:-}"

agents="$("$herdr" agent list | jq -c '[.result.agents[] | {key: .pane_id, value: .}] | from_entries')"
ws_names="$("$herdr" workspace list | jq -c '[.result.workspaces[] | {key: .workspace_id, value: (.label // .name)}] | from_entries')"

rows="$(jq -rs --argjson agents "$agents" --argjson ws "$ws_names" --arg t "$target" '
  map(select(.pane_id != null and $agents[.pane_id] != null))
  | group_by(.pane_id) | map(max_by(.updated_ms))
  | sort_by(if .pane_id == $t then 0 else 1 end, $ws[$agents[.pane_id].workspace_id])
  | .[] | . as $s
  | .prs[] | [.url, "\($ws[$agents[$s.pane_id].workspace_id] // $s.pane_id)\(if $s.pane_id == $t then " ←" else "" end)", "\(.repo)#\(.number)"] | @tsv
' "$state_dir"/*.json 2>/dev/null || true)"

if [[ -z "$rows" ]]; then
  echo "No PRs in live Claude sessions. Press any key."; read -rsn1; exit 0
fi

pr_line() {
  IFS=$'\t' read -r url space ref <<<"$1"
  gh pr view "$url" --json state,isDraft,title,statusCheckRollup,author,latestReviews,reviewRequests \
    | jq -r -L "$(dirname "$0")" --arg url "$url" --arg space "$space" --arg ref "$ref" 'include "review";
    def ci: [.statusCheckRollup[] | (.conclusion // .state)] as $c
      | if ($c | any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT")) then "✗"
        elif ($c | any(. == "PENDING" or . == "IN_PROGRESS" or . == "QUEUED" or . == "" or . == null)) then "…"
        else "✓" end;
    select(.state == "OPEN")
    | (if .isDraft then "98;114;164" else "80;250;123" end) as $rgb
    | "\($url)\t\($space)\t\u001b[38;2;\($rgb)m\($ref)\u001b[0m\t\(ci)\t\(review_state | review_badge)\t\(.title)"'
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
i=0
while IFS= read -r row; do
  i=$((i + 1))
  pr_line "$row" >"$tmp/$(printf '%03d' "$i")" &
done <<<"$rows"
wait

picked="$(cat "$tmp"/* \
  | fzf --ansi --delimiter '\t' --with-nth 2.. --tabstop 2 --reverse --no-sort \
        --header 'enter: open PR · esc: close' --prompt 'PRs › ' || true)"
[[ -n "$picked" ]] && open "${picked%%$'\t'*}"
