#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
py="python3 cleanup.py"
echo "Scanning worktrees (fetch + merged PRs)…"
$py scan
$py list | fzf --reverse --no-sort --ansi --delimiter='\t' --with-nth=2.. --track --id-nth=1 \
  --header="$($py header)" \
  --bind="space:execute-silent($py toggle {1})+reload($py list)+transform-header($py header)" \
  --bind="ctrl-a:execute-silent($py all)+reload($py list)+transform-header($py header)" \
  --bind="ctrl-d:execute-silent($py none)+reload($py list)+transform-header($py header)" \
  >/dev/null || exit 0
clear
$py header | tail -1
read -r -p "Remove the selected worktrees? (y/N) " ans
[[ "$ans" =~ ^[Yy]$ ]] || exit 0
$py apply
read -r -p "Done. Press Enter to close." _
