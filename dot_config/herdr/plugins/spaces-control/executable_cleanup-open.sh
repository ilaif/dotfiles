#!/usr/bin/env bash
set -euo pipefail
herdr="${HERDR_BIN_PATH:-herdr}"
opened="$("$herdr" plugin pane open --plugin "${HERDR_PLUGIN_ID:-ilai.spaces-control}" --entrypoint cleanup --placement tab \
  --env "CLEANUP_WS=${HERDR_WORKSPACE_ID:-}" --focus)"
"$herdr" tab focus "$(python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["plugin_pane"]["pane"]["tab_id"])' <<<"$opened")" >/dev/null
