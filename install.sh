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

# Claude PRs: the Herdr plugin, its Claude hook and its ccstatusline widget. The source files carry chezmoi's
# executable_ prefix, so the plugin is installed under its real names. A home without ccstatusline settings starts
# from Podium's.
plugin="$HOME/.config/herdr/plugins/claude-prs"
mkdir -p "$plugin"
for f in dot_config/herdr/plugins/claude-prs/*; do
  name="$(basename "$f")"
  case "$name" in
  executable_*) install -m 755 "$f" "$plugin/${name#executable_}" ;;
  *) install -m 644 "$f" "$plugin/$name" ;;
  esac
done
herdr plugin link "$plugin" >/dev/null

settings="$HOME/.claude/settings.json"
[[ -s "$settings" ]] || echo '{}' >"$settings"
jq --arg cmd "sh '$plugin/hook.sh'" '
  reduce ("SessionStart", "PostToolUse", "Stop", "SessionEnd") as $e (.;
    if any(.hooks[$e][]?.hooks[]; .command == $cmd) then .
    else .hooks[$e] += [{hooks: [{type: "command", command: $cmd, timeout: 10}]}] end)' \
  "$settings" >"$settings.tmp"
cat "$settings.tmp" >"$settings" && rm "$settings.tmp"

statusline="$HOME/.config/ccstatusline/settings.json"
if [[ ! -e "$statusline" ]]; then
  mkdir -p "${statusline%/*}"
  cp /usr/local/share/ccstatusline/settings.json "$statusline"
fi
jq --arg cmd "$plugin/statusline.sh" '
  if any(.lines[][]; .id == "claude-prs") then .
  else .lines[1] += [{id: "claude-prs", type: "custom-command", commandPath: $cmd, preserveColors: true, timeout: 1000}] end' \
  "$statusline" >"$statusline.tmp"
cat "$statusline.tmp" >"$statusline" && rm "$statusline.tmp"
