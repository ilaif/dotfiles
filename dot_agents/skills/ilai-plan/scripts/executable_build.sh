#!/usr/bin/env bash
# Build a plan page with web-artifacts-builder plus ilai-plan's readable theme.
#   build.sh <slug> App.tsx [--specs specs.json] [--repo <checkout>]
# App.tsx imports './readable-theme.css'; this clones the template once, drops the CSS into
# <slug>/src, then hands every argument to web-artifacts-builder's build.sh unchanged.
set -euo pipefail
SLUG="${1:?usage: build.sh <slug> App.tsx [--specs specs.json] [--repo dir]}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAB_SKILL="$HOME/.claude/skills/web-artifacts-builder"

if [ ! -d "$SLUG/src" ]; then
  eval "$(bash "$WAB_SKILL/scripts/ensure-deps.sh")"
  bash "$WAB/scripts/new-artifact.sh" "$SLUG" >/dev/null
fi
cp "$HERE/../assets/readable-theme.css" "$SLUG/src/readable-theme.css"
exec bash "$WAB_SKILL/scripts/build.sh" "$@"
