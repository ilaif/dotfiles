#!/usr/bin/env bash
# Herdr plugin action: open worktree-close prompts in a non-modal split pane
# below the invoking pane. Capture the original workspace and repo before
# opening the helper so its own pane context cannot change the close target.
set -euo pipefail

herdr="${HERDR_BIN_PATH:-herdr}"

jget() { grep -o "\"$2\":\"[^\"]*\"" <<<"$1" | head -n1 | sed 's/.*:"//;s/"$//'; }

pane="${HERDR_PANE_ID:-}"
if [[ -z "$pane" ]]; then
  panes_json="$("$herdr" pane list 2>/dev/null || true)"
  pane="$(python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for p in d['result']['panes']:
        if p.get('focused'):
            print(p['pane_id'])
            break
except Exception:
    pass
" <<<"$panes_json")"
fi
if [[ -z "$pane" ]]; then
  echo "dev-space: could not determine focused pane id" >&2
  exit 1
fi
ws="${HERDR_WORKSPACE_ID:-${pane%%:*}}"

pane_json="$("$herdr" pane get "$pane" 2>/dev/null || true)"
cwd="$(jget "$pane_json" foreground_cwd)"
[[ -z "$cwd" ]] && cwd="$(jget "$pane_json" cwd)"
[[ -z "$cwd" || ! -d "$cwd" ]] && cwd="$HOME"

exec "$herdr" plugin pane open --plugin "${HERDR_PLUGIN_ID:-ilai.dev-space}" --entrypoint close-worktree \
  --placement split --target-pane "$pane" --direction down \
  --env "DEVSPACE_WS=$ws" --env "DEVSPACE_CWD=$cwd" --focus
