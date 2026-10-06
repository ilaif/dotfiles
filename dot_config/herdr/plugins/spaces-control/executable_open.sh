#!/usr/bin/env bash
set -euo pipefail
exec "${HERDR_BIN_PATH:-herdr}" plugin pane open --plugin "${HERDR_PLUGIN_ID:-ilai.spaces-control}" --entrypoint picker --focus
