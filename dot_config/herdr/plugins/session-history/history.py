#!/usr/bin/env python3
"""Browser-style back/forward over focused agent panes.

`record` runs on every pane.focused event and appends agent panes to the history;
`back`/`forward` move the cursor and focus that pane, skipping panes that closed.
"""
import fcntl
import json
import os
import socket
import sys

STATE = os.path.join(os.environ["HERDR_PLUGIN_STATE_DIR"], "history.json")
LIMIT = 100


def call(method, **params):
    sock = socket.socket(socket.AF_UNIX)
    sock.connect(os.environ["HERDR_SOCKET_PATH"])
    sock.sendall((json.dumps({"id": "session-history", "method": method, "params": params}) + "\n").encode())
    buf = b""
    while not buf.endswith(b"\n"):
        buf += sock.recv(1 << 16)
    sock.close()
    return json.loads(buf)


def agent_pane(pane_id):
    pane = call("pane.get", pane_id=pane_id).get("result", {}).get("pane")
    return bool(pane and pane.get("agent"))


def record(state):
    pane_id = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])["data"]["pane_id"]
    if state["pending"] == pane_id:
        state["pending"] = None
        return
    state["pending"] = None
    stack, idx = state["stack"], state["idx"]
    if idx >= 0 and stack[idx] == pane_id:
        return
    if not agent_pane(pane_id):
        return
    stack = stack[: idx + 1] + [pane_id]
    state["stack"] = stack[-LIMIT:]
    state["idx"] = len(state["stack"]) - 1


def step(state, delta):
    idx = state["idx"] + delta
    while 0 <= idx < len(state["stack"]):
        pane_id = state["stack"][idx]
        if agent_pane(pane_id):
            state["idx"] = idx
            state["pending"] = pane_id
            call("pane.focus", pane_id=pane_id)
            return
        del state["stack"][idx]
        if delta < 0:
            idx -= 1
            state["idx"] -= 1


def main():
    with open(STATE + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = {"stack": [], "idx": -1, "pending": None}
        if os.path.exists(STATE):
            state = json.load(open(STATE))
        cmd = sys.argv[1]
        if cmd == "record":
            record(state)
        else:
            step(state, -1 if cmd == "back" else 1)
        with open(STATE, "w") as f:
            json.dump(state, f)


main()
