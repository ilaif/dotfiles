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

# The terminal-input and spaces-control plugins run python3 from their own directories; without a system one, the
# newest Python mise has installed becomes the global default.
if ! python3 --version >/dev/null 2>&1 && command -v mise >/dev/null; then
  python="$(mise ls --installed python --json 2>/dev/null | jq -r 'last.version // empty')"
  [[ -n "$python" ]] && mise use -g "python@$python" >/dev/null 2>&1
fi

# Copies a chezmoi source tree under the files' real names: an executable_ prefix becomes the executable bit.
install_tree() {
  local src="$1" dest="$2" f rel name
  while IFS= read -r -d '' f; do
    rel="${f#"$src"/}"
    name="$(basename "$rel")"
    case "$name" in
    executable_*) install -D -m 755 "$f" "$dest/$(dirname "$rel")/${name#executable_}" ;;
    *) install -D -m 644 "$f" "$dest/$rel" ;;
    esac
  done < <(find "$src" -type f -print0)
}

# Own agent skills, beside the ones other tools put in ~/.agents/skills (~/.claude/skills links there).
for src in dot_agents/skills/*/; do
  install_tree "${src%/}" "$HOME/.agents/skills/$(basename "$src")"
done
[[ -e "$HOME/.claude/skills" ]] || ln -s ../.agents/skills "$HOME/.claude/skills"

# Own Herdr plugins, linked in place. claude-prs and claude-recap feed on Claude hooks; claude-prs
# also has a ccstatusline widget, and a home without ccstatusline settings starts from Podium's.
plugins="$HOME/.config/herdr/plugins"
installed="$(herdr plugin list)"
for src in dot_config/herdr/plugins/*/; do
  dest="$plugins/$(basename "$src")"
  install_tree "${src%/}" "$dest"
  grep -qF "local:$dest]" <<<"$installed" || herdr plugin link "$dest" >/dev/null
done
plugin="$plugins/claude-prs"

settings="$HOME/.claude/settings.json"
[[ -s "$settings" ]] || echo '{}' >"$settings"
jq --arg prs "sh '$plugins/claude-prs/hook.sh'" --arg recap "bash '$plugins/claude-recap/hook.sh'" '
  reduce (
    ($prs | ["SessionStart", .], ["PostToolUse", .], ["Stop", .], ["SessionEnd", .]),
    ($recap | ["UserPromptSubmit", .], ["Stop", .], ["SessionEnd", .])
  ) as [$e, $cmd] (.;
    if any(.hooks[$e][]?.hooks[]; .command == $cmd) then .
    else .hooks[$e] += [{hooks: [{type: "command", command: $cmd, timeout: 10}]}] end)' \
  "$settings" >"$settings.tmp"
cat "$settings.tmp" >"$settings" && rm "$settings.tmp"

# Permission rules travel with the dotfiles: union claude-settings.json's allow list into the live one.
jq --slurpfile tracked claude-settings.json '
  .permissions.allow = (((.permissions.allow // []) + ($tracked[0].permissions.allow // [])) | unique)' \
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
