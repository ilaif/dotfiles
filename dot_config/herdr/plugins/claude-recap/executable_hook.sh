#!/bin/sh
# Claude Code hook (Stop, SessionEnd). Stores the turn's final assistant message per Herdr pane
# and publishes its first line as the `recap` sidebar token.
set -eu

[ "${HERDR_ENV:-}" = "1" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

HERDR_BIN="${HERDR_BIN_PATH:-herdr}"
STATE_DIR="${HERDR_CLAUDE_RECAP_STATE_DIR:-$HOME/.local/state/herdr-claude-recap}"
mkdir -p "$STATE_DIR"
HOOK_INPUT="$(mktemp "${TMPDIR:-/tmp}/herdr-claude-recap.XXXXXX")" || exit 0
trap 'rm -f "$HOOK_INPUT"' EXIT HUP INT TERM
cat >"$HOOK_INPUT" 2>/dev/null || true

HERDR_BIN="$HERDR_BIN" STATE_DIR="$STATE_DIR" HOOK_INPUT="$HOOK_INPUT" python3 - <<'PY'
import json, os, re, subprocess, sys, time

pane_id = os.environ["HERDR_PANE_ID"]
herdr = os.environ["HERDR_BIN"]
state_dir = os.environ["STATE_DIR"]
source = "ilai.claude-recap"
state_file = os.path.join(state_dir, pane_id.replace(":", "_") + ".json")

try:
    with open(os.environ["HOOK_INPUT"], encoding="utf-8") as fh:
        hook = json.load(fh)
except Exception:
    raise SystemExit(0)

if hook.get("agent_id"):
    raise SystemExit(0)

event = hook.get("hook_event_name") or ""

def report(*args):
    subprocess.run(
        [herdr, "pane", "report-metadata", pane_id, "--source", source, *args],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False,
    )

if event == "SessionEnd":
    report("--clear-token", "recap")
    try:
        os.remove(state_file)
    except FileNotFoundError:
        pass
    raise SystemExit(0)

if event != "Stop":
    raise SystemExit(0)

text = hook.get("last_assistant_message")
if not isinstance(text, str) or not text.strip():
    text = ""
    path = hook.get("transcript_path")
    if isinstance(path, str) and os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if entry.get("type") != "assistant" or entry.get("isSidechain"):
                    continue
                content = (entry.get("message") or {}).get("content") or []
                parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
                if any(p.strip() for p in parts):
                    text = "\n".join(parts)
if not text.strip():
    raise SystemExit(0)

def one_line(markdown):
    for raw in markdown.splitlines():
        line = raw.strip()
        line = re.sub(r"^(#+|[-*]|\d+\.)\s+", "", line)
        line = re.sub(r"(\*\*|__|`)", "", line)
        if line:
            return line
    return ""

short = re.sub(r"\s+", " ", one_line(text))
if len(short) > 78:
    short = short[:77].rstrip() + "…"

with open(state_file, "w", encoding="utf-8") as fh:
    json.dump(
        {
            "pane_id": pane_id,
            "session_id": hook.get("session_id"),
            "cwd": hook.get("cwd"),
            "updated_ms": int(time.time() * 1000),
            "short": short,
            "recap": text,
        },
        fh,
    )

report("--token", "recap=" + short, "--seq", str(time.time_ns()))
PY
