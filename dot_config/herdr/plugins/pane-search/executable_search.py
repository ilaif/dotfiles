#!/usr/bin/env python3
"""List every Herdr pane as one searchable fzf row, and focus a pane by id."""
import json
import os
import shlex
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HOME = os.path.expanduser("~")
HERDR = os.environ.get("HERDR_BIN_PATH", "herdr")
REMOTE_CACHE = os.path.join(HOME, ".local/state/herdr-pane-search/remote.json")
REMOTE_TTL = 20
LOGMATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logmatch.py")
DIM, BOLD, CYAN, GREEN, MAGENTA, YELLOW, RESET = "\033[2m", "\033[1m", "\033[36m", "\033[32m", "\033[35m", "\033[33m", "\033[0m"
STATUS = {"working": f"{YELLOW}●{RESET}", "blocked": f"\033[31m●{RESET}", "done": f"{GREEN}●{RESET}", "idle": f"{DIM}●{RESET}"}


def call(method, **params):
    sock = socket.socket(socket.AF_UNIX)
    sock.connect(os.environ.get("HERDR_SOCKET_PATH", os.path.join(HOME, ".config/herdr/herdr.sock")))
    sock.sendall((json.dumps({"id": "pane-search", "method": method, "params": params}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        buf += sock.recv(1 << 16)
    sock.close()
    return json.loads(buf)["result"]


def git_info(cwd):
    """(worktree name, branch) for a pane's cwd; the dir name and no branch outside git."""
    out = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], capture_output=True, text=True)
    if out.returncode:
        return os.path.basename(cwd), ""
    top, head = out.stdout.split()
    return os.path.basename(top), head


def remote(machine, *args):
    out = subprocess.run([HERDR, "--machine", machine, *args], capture_output=True, text=True, timeout=8)
    return json.loads(out.stdout)["result"]


def machines():
    """{label: ssh target} of the enabled remote machines."""
    listing = json.loads(subprocess.run([HERDR, "machine", "list", "--json"], capture_output=True, text=True).stdout)
    return {m["label"]: m["target"] for m in listing if m["enabled"]}


def sources(include_remote):
    """(machine, workspaces, tabs, panes) for this machine ("") and, optionally, each enabled remote that answers."""
    out = [("", call("workspace.list")["workspaces"], call("tab.list")["tabs"], call("pane.list")["panes"])]
    if include_remote:
        out += remote_sources()
    return out


def remote_sources():
    """Remote (machine, workspaces, tabs, panes), cached for REMOTE_TTL seconds so typing in log mode stays fast."""
    if os.path.exists(REMOTE_CACHE) and time.time() - os.path.getmtime(REMOTE_CACHE) < REMOTE_TTL:
        with open(REMOTE_CACHE) as f:
            return json.load(f)
    labels = list(machines())
    with ThreadPoolExecutor() as pool:
        out = [(m, *state) for m, state in zip(labels, pool.map(remote_lists, labels)) if state]
    os.makedirs(os.path.dirname(REMOTE_CACHE), exist_ok=True)
    with open(REMOTE_CACHE, "w") as f:
        json.dump(out, f)
    return out


def print_rows(rows):
    for line in sorted(rows):
        print(line[-1])


def list_rows(include_remote):
    print_rows([row for source in sources(include_remote) for row in source_rows(*source)])


def remote_lists(machine):
    try:
        return [remote(machine, kind, "list")[f"{kind}s"] for kind in ("workspace", "tab", "pane")]
    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
        return None


def session_matches(machine, query, sessions):
    """{session: [before, match, after]} from logmatch.py, run here or over ssh on the machine that holds the transcripts."""
    if not sessions:
        return {}
    with open(LOGMATCH) as script:
        if machine:
            cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", machines()[machine],
                   " ".join(shlex.quote(a) for a in ["python3", "-", query, *sessions])]
            out = subprocess.run(cmd, stdin=script, capture_output=True, text=True, timeout=15)
        else:
            out = subprocess.run(["python3", LOGMATCH, query, *sessions], capture_output=True, text=True)
    return json.loads(out.stdout) if out.returncode == 0 else {}


def log_rows(query):
    """Panes, local and remote, whose Claude transcript has query in the conversation, the match as the summary."""
    if not query:
        return
    rows = []

    def search(source):
        machine, spaces, tabs, panes = source
        claude = {p["agent_session"]["value"]: p for p in panes if p.get("agent") == "claude" and p.get("agent_session")}
        found = session_matches(machine, query, list(claude))
        summaries = {claude[s]["pane_id"]: f"…{b}{YELLOW}{m}{RESET}{a}…" for s, (b, m, a) in found.items()}
        matched = [p for p in panes if p["pane_id"] in summaries]
        return source_rows(machine, spaces, tabs, matched, summaries)

    with ThreadPoolExecutor() as pool:
        for found in pool.map(search, sources(include_remote=True)):
            rows += found
    print_rows(rows)


def source_rows(machine, spaces, tabs, panes, summaries=None):
    spaces = {w["workspace_id"]: w for w in spaces}
    tabs = {t["tab_id"]: t for t in tabs}
    cwds = sorted({p.get("foreground_cwd") or p["cwd"] for p in panes})
    if machine:
        git = {cwd: (os.path.basename(cwd), "") for cwd in cwds}
    else:
        with ThreadPoolExecutor() as pool:
            git = dict(zip(cwds, pool.map(git_info, cwds)))
    rows = []
    for p in panes:
        ws, tab = spaces[p["workspace_id"]], tabs[p["tab_id"]]
        cwd = p.get("foreground_cwd") or p["cwd"]
        worktree, head = git[cwd]
        session = (p.get("agent_session") or {}).get("value", "")
        who = p.get("agent") or p.get("terminal_title_stripped") or ""
        recap = (summaries or {}).get(p["pane_id"]) or (p.get("tokens") or {}).get("recap", "")
        where = f"{YELLOW}@{machine}{RESET} " if machine else ""
        key = "|".join([machine, p["pane_id"], p["tab_id"], "agent" if p.get("agent") else ""])
        rows.append((
            p["focused"] and not machine, machine, ws["number"], tab.get("number", 0),
            f"{key}\t{STATUS.get(p.get('agent_status'), ' ')} {where}{BOLD}{ws['label']}{RESET} {DIM}›{RESET} {tab['label']}"
            f"\t{CYAN}{who}{RESET}"
            f"\t{MAGENTA}{worktree}{RESET}"
            f"\t{GREEN}{head}{RESET}"
            f"\t{recap}"
            f"\t{DIM}{cwd.replace(HOME, '~')} {session}{RESET}",
        ))
    return rows


def focus(key):
    """Local panes focus exactly; a remote pane focuses its agent, or its tab when it runs no agent."""
    machine, pane_id, tab_id, agent = key.split("|")
    if not machine:
        call("pane.focus", pane_id=pane_id)
    elif agent:
        remote(machine, "agent", "focus", pane_id)
    else:
        remote(machine, "tab", "focus", tab_id)


def main():
    cmd, *args = sys.argv[1:]
    if cmd == "list":
        list_rows(include_remote=args != ["--local"])
    elif cmd == "logs":
        log_rows(" ".join(args))
    elif cmd == "focus":
        focus(args[0])


if __name__ == "__main__":
    main()
