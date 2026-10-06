#!/usr/bin/env python3
"""Shown / parked / hidden state for Herdr spaces.

shown   normal sidebar entry
parked  label prefixed with PARK and kept at the bottom of the sidebar; processes keep running
hidden  space closed; its cwd, label and Claude session ids are kept in STATE so it can be reopened
"""
import json
import os
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

PARK = "🗄 "
STATE_DIR = os.path.expanduser("~/.local/state/herdr-spaces-control")
STATE = os.path.join(STATE_DIR, "hidden.json")
MESSAGE = os.path.join(STATE_DIR, "message")
HERDR = os.environ.get("HERDR_BIN_PATH", "herdr")
BUSY = {"working", "blocked"}
RECAP_DIR = os.path.expanduser("~/.local/state/herdr-claude-recap")

DIM, BOLD, YELLOW, GREEN, RESET = "\033[2m", "\033[1m", "\033[33m", "\033[32m", "\033[0m"


def call(method, **params):
    sock = socket.socket(socket.AF_UNIX)
    sock.connect(os.environ.get("HERDR_SOCKET_PATH", os.path.expanduser("~/.config/herdr/herdr.sock")))
    sock.sendall((json.dumps({"id": "spaces-control", "method": method, "params": params}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        buf += sock.recv(1 << 16)
    sock.close()
    reply = json.loads(buf)
    if "error" in reply:
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def workspaces():
    return call("workspace.list")["workspaces"]


def load_hidden():
    if not os.path.exists(STATE):
        return []
    with open(STATE) as f:
        return json.load(f)


def save_hidden(hidden):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(hidden, f, indent=2)


def say(text):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(MESSAGE, "w") as f:
        f.write(text)


def is_parked(ws):
    return ws["label"].startswith(PARK)


def base_label(label):
    return label[len(PARK):] if label.startswith(PARK) else label


def space_path(ws, panes):
    if ws.get("worktree"):
        return ws["worktree"]["checkout_path"]
    root = next(p for p in panes if p["tab_id"] == ws["active_tab_id"])
    return root.get("foreground_cwd") or root["cwd"]


def sink_parked():
    parked = [ws["workspace_id"] for ws in workspaces() if is_parked(ws)]
    if parked:
        call("workspace.move_block", workspace_ids=parked, before_workspace_id=None)


def sweep():
    """Keep parked spaces at the bottom and drop hidden entries that were reopened or deleted."""
    sink_parked()
    open_paths = set()
    for ws in workspaces():
        open_paths.add(space_path(ws, call("pane.list", workspace_id=ws["workspace_id"])["panes"]))
    hidden = [h for h in load_hidden() if h["path"] not in open_paths and os.path.isdir(h["path"])]
    save_hidden(hidden)


def recap(ws_id):
    for pane in call("pane.list", workspace_id=ws_id)["panes"]:
        path = os.path.join(RECAP_DIR, pane["pane_id"].replace(":", "_") + ".json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)["short"]
    return ""


def repo_of(ws):
    return (ws.get("worktree") or {}).get("repo_name") or base_label(ws["label"])


REMOTE_CACHE = os.path.join(STATE_DIR, "remote.json")
REMOTE_TTL = 30


def machine_spaces(m):
    reply = subprocess.run([HERDR, "--machine", m["label"], "workspace", "list"], capture_output=True, text=True, timeout=8)
    return (m["label"], json.loads(reply.stdout)["result"]["workspaces"] if reply.returncode == 0 else None)


def remote_spaces():
    """Remote spaces per enabled machine, fetched in parallel and cached for REMOTE_TTL seconds."""
    if os.path.exists(REMOTE_CACHE) and time.time() - os.path.getmtime(REMOTE_CACHE) < REMOTE_TTL:
        with open(REMOTE_CACHE) as f:
            return json.load(f)
    machines = [m for m in json.loads(subprocess.run([HERDR, "machine", "list", "--json"], capture_output=True, text=True).stdout) if m["enabled"]]
    with ThreadPoolExecutor() as pool:
        out = [(label, spaces) for label, spaces in pool.map(machine_spaces, machines) if spaces is not None]
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(REMOTE_CACHE, "w") as f:
        json.dump(out, f)
    return out


def closed_worktrees():
    """Git worktrees of the open repos that have no open space and are not hidden entries."""
    repos = {ws["worktree"]["repo_root"] for ws in workspaces() if ws.get("worktree")}
    skip = {h["path"] for h in load_hidden()}
    out = []
    for repo in sorted(repos):
        listing = json.loads(subprocess.run([HERDR, "worktree", "list", "--cwd", repo], capture_output=True, text=True).stdout)["result"]
        for wt in listing["worktrees"]:
            if "open_workspace_id" not in wt and not wt["is_prunable"] and wt["path"] not in skip:
                out.append((wt["path"], os.path.basename(wt["path"]), wt.get("branch", "detached"), listing["source"]["repo_name"], repo))
    return out


def rows():
    """(key, state, label, status, summary, section, repo) per space; order is display order."""
    out = []
    spaces = workspaces()
    for ws in spaces:
        out.append((f"ws:{ws['workspace_id']}", "parked" if is_parked(ws) else "shown", base_label(ws["label"]),
                    ws["agent_status"], recap(ws["workspace_id"]), "local", repo_of(ws)))
    for h in load_hidden():
        out.append((f"hid:{h['path']}", "hidden", h["label"], f"{len(h['claude_sessions'])} claude",
                    h["path"].replace(os.path.expanduser("~"), "~"), "local", h.get("repo") or h["label"]))
    for path, label, branch, repo, root in closed_worktrees():
        out.append((f"wt:{root}|{path}", "closed", label, branch, path.replace(os.path.expanduser("~"), "~"), "local", repo))
    for machine, remote in remote_spaces():
        for ws in remote:
            out.append((f"rm:{machine}:{ws['workspace_id']}", "shown", ws["label"], ws["agent_status"], "",
                        f"remote · {machine}", repo_of(ws)))
    return out


def list_rows():
    marks = {"shown": f"{GREEN}●{RESET}", "parked": PARK.strip(), "hidden": f"{DIM}○{RESET}", "closed": f"{DIM}◌{RESET}"}
    all_rows = rows()
    width = max([len(r[2]) for r in all_rows] + [10])
    for section in dict.fromkeys(r[5] for r in all_rows):
        print(f"hdr:{section}\t{BOLD}━━ {section.upper()}{RESET}")
        in_section = [r for r in all_rows if r[5] == section]
        for repo in dict.fromkeys(r[6] for r in in_section):
            print(f"hdr:{section}/{repo}\t{DIM}  ▸ {repo}{RESET}")
            for key, state, label, status, summary, _, _ in (r for r in in_section if r[6] == repo):
                style = DIM if state in ("hidden", "closed") else ""
                print(f"{key}\t    {marks[state]} {style}{BOLD}{label:<{width}}{RESET}  {DIM}{status:<10}{RESET} {summary}")


def move(key, direction):
    kind, ref = key.split(":", 1)
    if kind != "ws":
        sys.exit(1)
    spaces = workspaces()
    ids = [w["workspace_id"] for w in spaces]
    i = ids.index(ref)
    group = lambda w: (repo_of(w), is_parked(w))
    step = -1 if direction == "up" else 1
    j = next((k for k in range(i + step, -1 if step < 0 else len(ids), step) if group(spaces[k]) == group(spaces[i])), None)
    if j is None:
        sys.exit(1)
    before = ids[j] if direction == "up" else (ids[j + 1] if j + 1 < len(ids) else None)
    call("workspace.move_block", workspace_ids=[ref], before_workspace_id=before)


def focus(key):
    kind, ref = key.split(":", 1)
    if kind == "rm":
        machine, ws_id = ref.rsplit(":", 1)
        subprocess.run([HERDR, "--machine", machine, "workspace", "focus", ws_id], check=True, capture_output=True)
        return
    if kind == "hid":
        unhide(ref)
        ref = ws_at(ref)["workspace_id"]
    elif kind == "wt":
        ref = open_worktree(ref, focus=True)
    call("workspace.focus", workspace_id=ref)


def ws_at(path):
    return next(w for w in workspaces() if space_path(w, call("pane.list", workspace_id=w["workspace_id"])["panes"]) == path)


def open_worktree(ref, focus):
    root, path = ref.split("|")
    cli("worktree", "open", "--cwd", root, "--path", path, "--focus" if focus else "--no-focus")
    return ws_at(path)["workspace_id"]


def cli(*args):
    out = subprocess.run([HERDR, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["result"]


def claude_sessions(ws_id):
    sessions = []
    for pane in call("pane.list", workspace_id=ws_id)["panes"]:
        path = os.path.join(RECAP_DIR, pane["pane_id"].replace(":", "_") + ".json")
        if os.path.exists(path):
            with open(path) as f:
                sessions.append(json.load(f)["session_id"])
    return sessions


def unhide(path, resume=True):
    hidden = load_hidden()
    entry = next(h for h in hidden if h["path"] == path)
    save_hidden([h for h in hidden if h["path"] != path])
    root = cli("workspace", "create", "--cwd", path, "--label", entry["label"], "--no-focus")["root_pane"]["pane_id"]
    for i, session in enumerate(entry["claude_sessions"] if resume else []):
        if i:
            root = cli("pane", "split", root, "--direction", "right", "--no-focus")["pane"]["pane_id"]
        cli("pane", "run", root, "claude", "--resume", session)


def detach_worktree(ws):
    """Move the panes of a worktree-grouped space into a plain space so the sidebar no longer nests it under its repo."""
    panes = call("pane.list", workspace_id=ws["workspace_id"])["panes"]
    moved = cli("pane", "move", panes[0]["pane_id"], "--new-workspace", "--no-focus")["move_result"]
    target = moved["pane"]["pane_id"]
    for pane in panes[1:]:
        cli("pane", "move", pane["pane_id"], "--tab", moved["created_tab"]["tab_id"], "--split", "right", "--target-pane", target, "--no-focus")
    return moved["created_workspace"]["workspace_id"]


def set_state(state, key):
    kind, ref = key.split(":", 1)
    if kind == "hid":
        unhide(ref, resume=state == "shown")
        ref = ws_at(ref)["workspace_id"]
    elif kind == "wt":
        ref = open_worktree(ref, focus=False)
    ws = next(w for w in workspaces() if w["workspace_id"] == ref)
    label = base_label(ws["label"])
    if state == "parked" and ws.get("worktree"):
        ref = detach_worktree(ws)
        cli("workspace", "rename", ref, label)
    if state == "parked":
        cli("workspace", "rename", ref, PARK + label)
        sink_parked()
    elif state == "shown":
        cli("workspace", "rename", ref, label)
    elif state == "hidden":
        path = space_path(ws, call("pane.list", workspace_id=ref)["panes"])
        hidden = load_hidden() + [{"path": path, "label": label, "repo": repo_of(ws), "claude_sessions": claude_sessions(ref)}]
        save_hidden(hidden)
        cli("workspace", "close", ref)


def header():
    base = "enter focus · ctrl-s show · ctrl-p park · ctrl-x hide · alt-↑/↓ move · esc close"
    msg = open(MESSAGE).read().strip() if os.path.exists(MESSAGE) else ""
    print(f"{base}\n{YELLOW}{msg}{RESET}" if msg else base)


def main():
    cmd, *args = sys.argv[1:]
    try:
        if cmd == "list":
            list_rows()
        elif cmd == "sweep":
            say("")
            sweep()
        elif cmd == "move":
            move(args[0], args[1])
        elif cmd == "focus":
            focus(args[0])
        elif cmd == "set":
            set_state(args[0], args[1])
        elif cmd == "header":
            header()
    except RuntimeError as err:
        say(str(err))


if __name__ == "__main__":
    main()
