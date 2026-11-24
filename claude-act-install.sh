#!/bin/bash
# One-line install of claude-act (Claude subscription, GitHub Copilot through Bifrost once it is spent) on macOS:
#   curl -fsSL https://raw.githubusercontent.com/ilaif/dotfiles/main/claude-act-install.sh | bash
set -euo pipefail

ref="${CLAUDE_ACT_REF:-main}"
raw="https://raw.githubusercontent.com/ilaif/dotfiles/$ref"
dir="$HOME/.config/claude-model-router"
bin="$HOME/.local/bin"
label=dev.claude-model-router
plist="$HOME/Library/LaunchAgents/$label.plist"

[[ $(uname) == Darwin ]] || { echo "claude-act needs macOS (the router runs as a LaunchAgent)" >&2; exit 1; }
for tool in node jq curl claude; do
  command -v "$tool" >/dev/null || { echo "missing $tool: install it first" >&2; exit 1; }
done

echo "Downloading from ilaif/dotfiles@$ref"
mkdir -p "$dir/bifrost" "$bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
for f in router.mjs config.example.json bifrost.config.example.json README.md; do
  curl -fsSL "$raw/dot_config/claude-model-router/$f" -o "$dir/$f"
done
for f in claude-act claude-router; do
  curl -fsSL "$raw/dot_local/bin/executable_$f" -o "$bin/$f"
  chmod +x "$bin/$f"
done

# A config from before Bifrost (it has "routes") is set aside; the router now serves extra models through Bifrost.
if [[ -f $dir/config.json ]] && jq -e '.routes' "$dir/config.json" >/dev/null; then
  mv "$dir/config.json" "$dir/config.json.pre-bifrost"
  echo "Moved the old router config to $dir/config.json.pre-bifrost"
fi
[[ -f $dir/config.json ]] || cp "$dir/config.example.json" "$dir/config.json"
[[ -f $dir/bifrost/config.json ]] || cp "$dir/bifrost.config.example.json" "$dir/bifrost/config.json"
rm -f "$bin/claude-copilot" "$bin/claude-copilot-token" "$bin/claude-router-statusline" "$dir/fallback-until"

if [[ ! -s $HOME/.local/share/copilot-api/github_token ]]; then
  echo "Sign in to GitHub Copilot (device login):"
  npm exec --yes --package=copilot-api@0.7.0 -- copilot-api auth </dev/tty
fi

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
for _ in $(seq 60); do
  [[ -s $dir/tls/ca.pem ]] && curl -s -o /dev/null -m 1 http://127.0.0.1:8790/health && break
  sleep 1
done

echo "Checking a request through the router..."
"$bin/claude-act" -p "Reply with OK" </dev/null
curl -fsS -m 60 http://127.0.0.1:8790/anthropic/v1/messages -H 'content-type: application/json' \
  -d '{"model":"github-copilot/claude-haiku-4.5","max_tokens":5,"messages":[{"role":"user","content":"Reply with OK"}]}' >/dev/null \
  || { echo "Copilot through Bifrost failed: does this GitHub account have a Copilot seat? See: claude-router logs" >&2; exit 1; }
cat <<DONE

Installed. Start sessions with: claude-act
- Your saved /model runs on the Claude subscription; once it and any extra usage are spent, requests go to Copilot.
- Watch routing: claude-router logs
- Optional: alias claude=claude-act in your shell rc
- Copilot models in /model: add github-copilot/<model> rows to modelPicker (see the README)
Docs: $dir/README.md
DONE
