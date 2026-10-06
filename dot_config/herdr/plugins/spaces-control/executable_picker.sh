#!/usr/bin/env bash
set -euo pipefail
sv="$(cd "$(dirname "$0")" && pwd)/spaces.py"
python3 "$sv" sweep
list="python3 '$sv' list"
key="$(python3 "$sv" list | fzf --reverse --no-sort --ansi --delimiter='\t' --with-nth=2.. \
  --header="enter focus · ctrl-s show · ctrl-p park · ctrl-x hide · alt-↑/↓ move · esc close" \
  --bind="start:down" \
  --bind="enter:transform:[[ {1} == hdr:* ]] && echo ignore || echo accept" \
  --bind="ctrl-s:execute-silent(python3 '$sv' set shown {1})+reload($list)+transform-header(python3 '$sv' header)" \
  --bind="ctrl-p:execute-silent(python3 '$sv' set parked {1})+reload($list)+transform-header(python3 '$sv' header)" \
  --bind="ctrl-x:execute-silent(python3 '$sv' set hidden {1})+reload($list)+transform-header(python3 '$sv' header)" \
  --bind="alt-up:transform:python3 '$sv' move {1} up && echo \"reload($list)+up\" || echo ignore" \
  --bind="alt-down:transform:python3 '$sv' move {1} down && echo \"reload($list)+down\" || echo ignore" \
  | cut -f1)" || exit 0
python3 "$sv" focus "$key"
