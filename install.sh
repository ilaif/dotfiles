#!/bin/bash
# Podium workspaces run this on boot from ~/.dotfiles (it wins over bootstrap.sh). The full chezmoi apply is
# laptop-only (brew, gh auth login), so this sets up just the agent config that works on Linux.

set -e
cd "$(dirname "$0")"

mkdir -p "$HOME/.claude" "$HOME/.codex"
touch "$HOME/.claude/.i-have-adhd-always"
ln -sfn "$PWD/dot_codex/AGENTS.md" "$HOME/.codex/AGENTS.md"
bash ./run_onchange_after_5-adhd-plugins
