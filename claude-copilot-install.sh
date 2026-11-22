#!/bin/bash
# One-line install of claude-copilot (Claude subscription with a GitHub Copilot fallback) on macOS:
#   curl -fsSL https://raw.githubusercontent.com/ilaif/dotfiles/main/claude-copilot-install.sh | bash
set -euo pipefail

ref="${CLAUDE_COPILOT_REF:-main}"
raw="https://raw.githubusercontent.com/ilaif/dotfiles/$ref"
dir="$HOME/.config/claude-model-router"
bin="$HOME/.local/bin"
label=dev.claude-model-router
plist="$HOME/Library/LaunchAgents/$label.plist"

[[ $(uname) == Darwin ]] || { echo "claude-copilot needs macOS (the router runs as a LaunchAgent)" >&2; exit 1; }
for tool in node jq curl claude; do
  command -v "$tool" >/dev/null || { echo "missing $tool: install it first" >&2; exit 1; }
done

echo "Downloading from ilaif/dotfiles@$ref"
mkdir -p "$dir" "$bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
for f in router.mjs config.example.json README.md; do
  curl -fsSL "$raw/dot_config/claude-model-router/$f" -o "$dir/$f"
done
for f in claude-copilot claude-copilot-token claude-router claude-router-statusline; do
  curl -fsSL "$raw/dot_local/bin/executable_$f" -o "$bin/$f"
  chmod +x "$bin/$f"
done

# Keep an existing config (other routes); add only the Copilot route and the fallback when missing.
if [[ -f $dir/config.json ]]; then
  jq --slurpfile ex "$dir/config.example.json" '($ex[0]) as $e
    | .subscriptionFallback //= $e.subscriptionFallback
    | .routes = ((.routes // []) | if any(.[]; .modelPrefix == "copilot/") then . else . + $e.routes end)' \
    "$dir/config.json" >"$dir/config.json.tmp"
  mv "$dir/config.json.tmp" "$dir/config.json"
else
  cp "$dir/config.example.json" "$dir/config.json"
fi

if [[ ! -s $HOME/.local/share/copilot-api/github_token ]]; then
  echo "Sign in to GitHub Copilot (device login):"
  npm exec --yes --package=copilot-api@0.7.0 -- copilot-api auth </dev/tty
fi
"$bin/claude-copilot-token" >/dev/null || { echo "Copilot token exchange failed: does this GitHub account have a Copilot seat?" >&2; exit 1; }

cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$(command -v node)</string><string>$dir/router.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/claude-model-router.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/claude-model-router.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
for _ in $(seq 20); do
  [[ -s $dir/tls/ca.pem ]] && curl -s -o /dev/null -m 1 http://127.0.0.1:8787 && break
  sleep 0.5
done

echo "Checking a request through the router..."
"$bin/claude-copilot" -p "Reply with OK" </dev/null
cat <<DONE

Installed. Start sessions with: claude-copilot
- Opus (your saved /model) runs on the Claude subscription and moves to Copilot before extra usage starts.
- Watch routing: claude-router logs
- Optional: alias claude=claude-copilot in your shell rc
- Optional status line: a ccstatusline custom-command widget running $bin/claude-router-statusline
Docs: $dir/README.md
DONE
