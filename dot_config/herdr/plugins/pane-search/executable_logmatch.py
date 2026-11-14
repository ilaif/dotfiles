#!/usr/bin/env python3
"""Search Claude transcripts on this machine for conversation text.

usage: logmatch.py <query> <session-id>...
prints {session: [before, match, after]} for the sessions whose own words (yours or Claude's, not tool output
or injected context) contain query, case-insensitively, using the latest match. Stdlib + rg only, so it can be
piped to python3 on a remote machine.
"""
import glob
import json
import os
import subprocess
import sys

CONTEXT = 60


def said(line):
    rec = json.loads(line)
    if rec.get("type") not in ("user", "assistant") or rec.get("isMeta"):
        return ""
    content = rec["message"]["content"]
    blocks = [content] if isinstance(content, str) else [b["text"] for b in content if b["type"] == "text"]
    return " ".join(b for b in blocks if not b.startswith("<"))


def latest_match(path, query):
    lines = subprocess.run(["rg", "-i", "-F", "--no-filename", query, path], capture_output=True, text=True).stdout.splitlines()
    for line in reversed(lines):
        text = " ".join(said(line).split())
        i = text.lower().find(query.lower())
        if i >= 0:
            end = i + len(query)
            return [text[max(i - CONTEXT, 0):i], text[i:end], text[end:end + CONTEXT]]
    return None


def main():
    query, *sessions = sys.argv[1:]
    paths = {}
    for session in sessions:
        found = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session}.jsonl"))
        if found:
            paths[found[0]] = session
    hits = subprocess.run(["rg", "-l", "-i", "-F", query, *paths], capture_output=True, text=True).stdout.split() if paths else []
    matches = {paths[path]: latest_match(path, query) for path in hits}
    print(json.dumps({session: m for session, m in matches.items() if m}))


if __name__ == "__main__":
    main()
