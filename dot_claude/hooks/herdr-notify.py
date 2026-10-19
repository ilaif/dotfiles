#!/usr/bin/env python3
"""Claude Stop/Notification hook: macOS notification that focuses the originating Herdr pane on click.

Usage: herdr-notify.py            (hook mode, reads hook JSON on stdin)
       herdr-notify.py focus <pane_id>
"""
import json
import os
import socket
import subprocess
import sys

SOCKET = os.path.expanduser("~/.config/herdr/herdr.sock")
NOTIFIER = os.path.expanduser("~/Applications/ClaudeNotifier.app/Contents/MacOS/terminal-notifier")
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "act-logo.png")


def call(method, params):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(os.environ.get("HERDR_SOCKET_PATH", SOCKET))
    client.sendall((json.dumps({"id": method, "method": method, "params": params}) + "\n").encode())
    data = b""
    while not data.endswith(b"\n"):
        data += client.recv(65536)
    client.close()
    return json.loads(data)["result"]  # no-smell: stdlib-only hook script, no pydantic


def focus(pane_id):
    call("pane.focus", {"pane_id": pane_id})
    subprocess.run(["open", "-b", "com.mitchellh.ghostty"])


def notify():
    pane_id = os.environ.get("HERDR_PANE_ID")
    if os.environ.get("HERDR_ENV") != "1" or not pane_id:
        return
    hook = json.load(sys.stdin)
    if hook.get("agent_id"):
        return
    pane = call("pane.get", {"pane_id": pane_id})["pane"]
    if pane["focused"]:
        return
    workspace = call("workspace.get", {"workspace_id": pane["workspace_id"]})["workspace"]
    message = hook.get("message") or "Finished"
    subprocess.Popen(
        [
            NOTIFIER,
            "-title", f"Claude · {workspace['label']}",
            "-message", message,
            "-group", f"herdr-{pane_id}",
            "-contentImage", LOGO,
            "-execute", f"{sys.executable} {os.path.abspath(__file__)} focus '{pane_id}'",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


if __name__ == "__main__":
    if sys.argv[1:2] == ["focus"]:
        focus(sys.argv[2])
    else:
        notify()
