#!/usr/bin/env bash
set -euo pipefail
herdr="${HERDR_BIN_PATH:-herdr}"
target="${HERDR_PANE_ID:-}"
if [[ -z "$target" ]]; then
  target="$("$herdr" pane current 2>/dev/null | jq -r '.result.pane.pane_id // empty' || true)"
fi
"$herdr" plugin pane open --plugin "${HERDR_PLUGIN_ID:-ilai.claude-recap}" --entrypoint viewer \
  --env "RECAP_TARGET_PANE=${target}" --focus
