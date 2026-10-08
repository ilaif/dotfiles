"""Watch Herdr's plain shell panes and surface commands waiting on terminal input.

A pane is flagged when its foreground command is not the shell, its recent output has not
changed for IDLE_SECONDS, and the last non-blank line looks like a prompt.
"""

import fcntl
import json
import os
import re
import socket
import sys
import time

SOCKET = os.environ["HERDR_SOCKET_PATH"]
STATE_DIR = os.environ["HERDR_PLUGIN_STATE_DIR"]
SOURCE = "ilai.terminal-input"
AGENT = "shell"
LABEL = "Terminal input"
IDLE_SECONDS = 3
DONE_SECONDS = 30
SKIP = {
    "vim", "nvim", "vi", "nano", "emacs", "less", "more", "man", "htop", "top", "btop", "k9s",
    "tig", "hunk", "lazygit", "fzf", "watch", "tmux", "herdr", "ssh", "coder", "claude", "codex",
    "psql", "mysql", "sqlite3", "python", "python3", "ipython", "node", "bun", "deno", "irb",
}
PROMPT = re.compile(
    r"([?:>]|\[[yn]/[yn]\]|\([yn]/[yn]\))$|password|passphrase|press (enter|any key)",
    re.IGNORECASE,
)


def call(method, **params):
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(SOCKET)
        s.sendall((json.dumps({"id": SOURCE, "method": method, "params": params}) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            buf += s.recv(65536)
    return json.loads(buf).get("result")


def foreground_command(pane_id):
    info = call("pane.process_info", pane_id=pane_id)["process_info"]
    if info["foreground_process_group_id"] == info["shell_pid"]:
        return None
    procs = info["foreground_processes"]
    lead = next((p for p in procs if p["pid"] == info["foreground_process_group_id"]), procs[0])
    return lead


def last_line(screen):
    lines = [l.rstrip() for l in screen.splitlines() if l.strip()]
    return lines[-1] if lines else ""


def block(pane_id, cmd, line):
    call("pane.report_agent", pane_id=pane_id, source=SOURCE, agent=AGENT, state="blocked",
         message=f"{cmd}: {line}")
    call("pane.report_metadata", pane_id=pane_id, source=SOURCE, agent=AGENT, display_agent=LABEL)


def release(pane_id):
    call("pane.release_agent", pane_id=pane_id, source=SOURCE, agent=AGENT)


def finish(pane_id, track, focused):
    if track["blocked"]:
        release(pane_id)
    elapsed = int(time.time() - track["start"])
    if elapsed >= DONE_SECONDS and not focused:
        call("notification.show", title=f"Done ({elapsed}s)", body=track["cmdline"], sound="done")


def run():
    tracks = {}
    while True:
        panes = {p["pane_id"]: p for p in call("pane.list")["panes"]}
        for pane_id in list(tracks):
            if pane_id not in panes:
                del tracks[pane_id]
        for pane_id, pane in panes.items():
            if pane.get("agent") not in (None, AGENT):
                continue
            proc = foreground_command(pane_id)
            track = tracks.get(pane_id)
            if proc is None or (track and track["pid"] != proc["pid"]):
                if track:
                    finish(pane_id, track, pane["focused"])
                    del tracks[pane_id]
                if proc is None:
                    continue
            name = os.path.basename(proc.get("argv0") or proc["name"])
            if name in SKIP:
                continue
            if pane_id not in tracks:
                tracks[pane_id] = {"pid": proc["pid"], "cmdline": proc.get("cmdline") or name,
                                   "start": time.time(), "screen": None, "since": time.time(),
                                   "blocked": False}
            track = tracks[pane_id]
            screen = call("pane.read", pane_id=pane_id, source="recent", lines=50)["read"]["text"]
            if screen != track["screen"]:
                track["screen"], track["since"] = screen, time.time()
                if track["blocked"]:
                    release(pane_id)
                    track["blocked"] = False
                continue
            if track["blocked"] or time.time() - track["since"] < IDLE_SECONDS:
                continue
            line = last_line(screen)
            if PROMPT.search(line):
                block(pane_id, name, line)
                track["blocked"] = True
        time.sleep(1)


def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    lock = open(os.path.join(STATE_DIR, "watch.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    if "--spawn" in sys.argv:
        if os.fork():
            return
        os.setsid()
        log = os.open(os.path.join(STATE_DIR, "watch.log"), os.O_WRONLY | os.O_CREAT | os.O_APPEND)
        null = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null, 0)
        os.dup2(log, 1)
        os.dup2(log, 2)
    run()


main()
