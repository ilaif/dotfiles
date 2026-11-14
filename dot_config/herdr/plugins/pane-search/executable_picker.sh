#!/usr/bin/env bash
set -euo pipefail
ps="$(cd "$(dirname "$0")" && pwd)/search.py"
filled="$(mktemp -u)"
trap 'rm -f "$filled"' EXIT
key="$(python3 "$ps" list --local | fzf --reverse --ansi --delimiter='\t' --with-nth=2.. --prompt='panes> ' \
  --header="enter focus · ctrl-g switch panes ⇄ session logs · esc close" \
  --bind="start:unbind(change)" \
  --bind="load:transform:[ -e '$filled' ] || { touch '$filled'; echo \"reload-sync(python3 '$ps' list)\"; }" \
  --bind="change:reload:sleep 0.15; python3 '$ps' logs {q}" \
  --bind="ctrl-g:transform:[[ \$FZF_PROMPT == panes* ]] \
    && echo \"change-prompt(logs> )+disable-search+rebind(change)+reload(python3 '$ps' logs {q})\" \
    || echo \"change-prompt(panes> )+enable-search+unbind(change)+reload(python3 '$ps' list)\"" \
  | cut -f1)" || exit 0
python3 "$ps" focus "$key"
