---
name: hide
description: Park, hide or show a Herdr space (workspace) from an agent — the same states as the Space Visibility plugin popup. Use when the user asks to park, hide, unhide, show or shelve a space.
disable-model-invocation: true
---

# hide

Drives the Herdr **Space Visibility** plugin (`~/.config/herdr/plugins/space-visibility/spaces.py`) without its popup.
The plugin owns the logic and state; this skill only calls it. Requires `HERDR_ENV=1` — if unset, say you are not inside
Herdr and stop.

| State | Effect |
|---|---|
| `shown` | normal sidebar entry |
| `parked` | label prefixed `🗄 `, moved to the bottom of the sidebar; processes keep running |
| `hidden` | space closed; its path, label and Claude session ids are saved in `~/.local/state/herdr-space-visibility/hidden.json`, so `shown`/`parked` reopens it and resumes those sessions |

The argument names the space (label, workspace id like `w70`, or worktree path) and the target state; "park" is the
default when no state is given. "hide" means `hidden`.

## Steps

```bash
SV=~/.config/herdr/plugins/space-visibility/spaces.py
python3 "$SV" sweep
python3 "$SV" list | sed 's/\x1b\[[0-9;]*m//g'   # key<TAB>state label repo status path
```

1. Find the row whose label, id or path matches; its first column is the key (`ws:<id>` for open spaces, `hid:<path>`
   for hidden ones). If several match, ask which.
2. `python3 "$SV" set <shown|parked|hidden> <key>`
3. Read `~/.local/state/herdr-space-visibility/message`: a non-empty message is a refusal (e.g. hiding a space whose
   agent is working — park it instead) — report it.
4. Re-run `list` and report the space's new state in one line.

Never hide the space you are running in; park it instead.
