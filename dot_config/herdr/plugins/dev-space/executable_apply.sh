#!/usr/bin/env bash
# Herdr plugin action: open a new space, prompt for a directory, then lay out
# claude (left, 40%, terminal below at 15% height) with nvim above
# a review pane (right, 60%, 50/50).
# The directory prompt and layout are driven by pick-dir.sh inside the pane.
#
# With --here, skip the directory picker and act on the invoking pane's repo.
set -euo pipefail

herdr="${HERDR_BIN_PATH:-herdr}"
here="$(cd "$(dirname "$0")" && pwd)"

jget() { grep -o "\"$2\":\"[^\"]*\"" <<<"$1" | head -n1 | sed 's/.*:"//;s/"$//'; }

# Seed the space in a sensible cwd; the picker overrides this on selection.
cwd=""
if [[ -n "${HERDR_PANE_ID:-}" ]]; then
  pane_json="$("$herdr" pane get "$HERDR_PANE_ID" 2>/dev/null || true)"
  cwd="$(jget "$pane_json" foreground_cwd)"
  [[ -z "$cwd" ]] && cwd="$(jget "$pane_json" cwd)"
fi
[[ -z "$cwd" ]] && cwd="${PWD:-$HOME}"
[[ -d "$cwd" ]] || cwd="$HOME"

label="new space..."
picker_arg=""
if [[ "${1:-}" == "--here" ]]; then
  git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "dev-space: not a git repo: $cwd" >&2
    exit 1
  }
  label="worktree of $(basename "$cwd")..."
  picker_arg=" '$cwd'"
fi

ws_json="$("$herdr" workspace create --cwd "$cwd" --label "$label" --focus)"
pane="$(jget "$ws_json" pane_id)"
if [[ -z "$pane" ]]; then
  echo "dev-space: could not determine root pane id" >&2
  echo "$ws_json" >&2
  exit 1
fi

# Let the pane's shell come up before sending the picker (avoids a startup race).
sleep 0.4
"$herdr" pane run "$pane" "'$here/pick-dir.sh'$picker_arg" >/dev/null 2>&1 || true
