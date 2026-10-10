#!/bin/sh
# Claude Code hook (SessionStart, PostToolUse:Bash, Stop, SessionEnd).
# Records the PRs a session created or pushed to in ~/.local/state/claude-prs/<session_id>.json and
# publishes its open and draft PRs as the `open1`..`open8` / `draft1`..`draft8` sidebar tokens on the
# session's Herdr pane. Bash calls that cannot touch a PR return immediately; the rest runs detached.
set -eu

STATE_DIR="${CLAUDE_PRS_STATE_DIR:-$HOME/.local/state/claude-prs}"
HERDR="${HERDR_BIN_PATH:-herdr}"
SOURCE="ilai.claude-prs"
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
SLOTS=8
PR_URL='https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+'
PR_COMMAND='gh pr create|gh stack|git push'

if [ "${1:-}" != "--run" ]; then
  input="$(cat)"
  case "$input" in
    *'"PostToolUse"'*) printf '%s' "$input" | grep -qE "$PR_COMMAND" || exit 0 ;;
  esac
  printf '%s' "$input" | nohup sh "$0" --run >/dev/null 2>&1 &
  exit 0
fi

hook="$(cat)"
field() { printf '%s' "$hook" | jq -r "$1"; }

event="$(field .hook_event_name)"
# A subagent shares its parent's session_id, so the PRs it opens or pushes belong to that session; only its
# other events are skipped.
[ -z "$(field '.agent_id // empty')" ] || [ "$event" = "PostToolUse" ] || exit 0
session_id="$(field .session_id)"
cwd="$(field .cwd)"
pane_id="${HERDR_PANE_ID:-}"
state_file="$STATE_DIR/$session_id.json"
mkdir -p "$STATE_DIR"

clear_args() {
  jq -rn --argjson slots "$SLOTS" '[range(1; $slots + 1) as $i | "open", "draft" | "--clear-token", "\(.)\($i)"] | .[]'
}

report() {
  [ "${HERDR_ENV:-}" = "1" ] && [ -n "$pane_id" ] || return 0
  "$HERDR" pane report-metadata "$pane_id" --source "$SOURCE" "$@" >/dev/null 2>&1
}

publish() {
  set --
  # With no open or draft PRs the second substitution is empty; skip that blank line, herdr rejects '' as an option.
  while IFS= read -r arg; do [ -z "$arg" ] || set -- "$@" "$arg"; done <<EOF
$(clear_args)
$(jq -r -L "$PLUGIN_DIR" --argjson slots "$SLOTS" 'include "review";
  def slots($kind; $states): [.prs[] | select(.state as $s | $states | index($s))][-$slots:]
    | to_entries[] | "--token", "\($kind)\(.key + 1)=\([(.value.review | review_icon), "\(.value.repo)#\(.value.number)"] | map(select(. != "")) | join(" "))";
  slots("open"; [null, "OPEN"]), slots("draft"; ["DRAFT"])' "$state_file")
EOF
  report "$@"
}

refresh() {
  tmp="$(mktemp -d)"
  for url in $(jq -r '.prs[] | select(.state != "MERGED" and .state != "CLOSED") | .url' "$state_file"); do
    gh pr view "$url" --json url,state,isDraft,author,latestReviews,reviewRequests \
      | jq -L "$PLUGIN_DIR" 'include "review";
        {(.url): {state: (if .isDraft and .state == "OPEN" then "DRAFT" else .state end), review: review_state}}' >"$tmp/${url##*/}" &
  done
  wait
  states="$(cat "$tmp"/* 2>/dev/null | jq -s 'add // {}')"
  jq --argjson s "$states" '.prs[] |= (. + ($s[.url] // {})) | .refreshed_ms = (now * 1000 | floor)' "$state_file" >"$tmp/state.json"
  mv "$tmp/state.json" "$state_file"
  rm -rf "$tmp"
}

branch_pr_url() { (cd "$1" && gh pr view --json url --jq .url 2>/dev/null) || true; }

# The Bash tool resets its cwd after each call, so a push in another repo names it in the command itself:
# `git -C <dir> push` or the last `cd <dir>` before it. Anything else pushed from the session's cwd.
push_dir() {
  dir="$(printf '%s' "$1" | sed -nE 's/.*git -C +([^ ;&|]+) +push.*/\1/p')"
  [ -n "$dir" ] || dir="$(printf '%s' "$1" | sed -nE 's/.*(^|[;&|( ])cd +([^ ;&|)]+).*git push.*/\2/p')"
  case "$dir" in
    '') dir="$cwd" ;;
    '~'*) dir="$HOME${dir#\~}" ;;
    /*) ;;
    *) dir="$cwd/$dir" ;;
  esac
  printf '%s' "$dir"
}

if [ "$event" = "SessionEnd" ]; then
  set --
  while IFS= read -r arg; do set -- "$@" "$arg"; done <<EOF
$(clear_args)
EOF
  report "$@"
  exit 0
fi

urls=""
case "$event" in
  SessionStart) urls="$(branch_pr_url "$cwd")" ;;
  PostToolUse)
    urls="$(field '"\(.tool_response.stdout // "")\n\(.tool_response.stderr // "")"' | grep -oE "$PR_URL" || true)"
    command="$(field .tool_input.command)"
    case "$command" in
      *"git push"*) urls="$urls
$(branch_pr_url "$(push_dir "$command")")" ;;
    esac
    ;;
esac

if [ ! -s "$state_file" ]; then
  jq -n --arg id "$session_id" '{session_id: $id, prs: []}' >"$state_file.$$"
  mv "$state_file.$$" "$state_file"
fi
jq --arg urls "$urls" --arg pane "$pane_id" --arg cwd "$cwd" '
  reduce ($urls | split("\n")[] | select(test("/pull/[0-9]+$"))) as $url (.;
    if any(.prs[]; .url == $url) then . else
      .prs += [{url: $url, repo: ($url | split("/")[4]), number: ($url | split("/")[6] | tonumber), added_ms: (now * 1000 | floor)}]
    end)
  | .pane_id = $pane | .cwd = $cwd | .updated_ms = (now * 1000 | floor)' "$state_file" >"$state_file.$$"
mv "$state_file.$$" "$state_file"

[ "$(jq '.prs | length' "$state_file")" -gt 0 ] || exit 0
publish
case "$event" in
  SessionStart | Stop) refresh && publish ;;
esac
