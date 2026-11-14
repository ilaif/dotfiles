#!/bin/bash
# Podium workspaces run this on boot from ~/.dotfiles (it wins over bootstrap.sh). The source is OS-aware, so
# this is the same chezmoi apply the Mac runs; macOS-only parts (brew, launchd, notifier) skip on Linux.

set -e
cd "$(dirname "$0")"

# Podium's agent CLIs (claude, codex, npx) are mise shims for the act checkout's Node, so expose that
# toolchain to the apply's run scripts. Until the workspace's first Toolchain step installs it, they skip.
[[ -n "${PODIUM_WORKSPACE_DIR:-}" ]] && eval "$(mise env -C "$PODIUM_WORKSPACE_DIR" -s bash)"

command -v chezmoi >/dev/null || sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"

# --force: a Podium home is rebuilt from this repo, so tracked files always take the repo's version.
chezmoi init --apply --force --no-tty --source "$PWD" \
  --promptString "Git username=$(git config --global user.name),Git email address=$(git config --global user.email)"
