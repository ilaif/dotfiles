#!/bin/bash
# Podium workspaces run this on boot from ~/.dotfiles (it wins over bootstrap.sh). The full chezmoi apply is
# laptop-only (brew, gh auth login), so this sets up just the agent config that works on Linux.

set -e
cd "$(dirname "$0")"

mkdir -p "$HOME/.claude" "$HOME/.codex"
touch "$HOME/.claude/.i-have-adhd-always"
ln -sfn "$PWD/dot_codex/AGENTS.md" "$HOME/.codex/AGENTS.md"
# The agent CLIs are mise shims for the act checkout's Node, so they only run from inside it, and only once
# its Toolchain step has installed that Node: on a workspace's first boot Codex gets its plugin on the next one.
(cd "$PODIUM_WORKSPACE_DIR" && bash "$OLDPWD/run_onchange_after_5-adhd-plugins")
