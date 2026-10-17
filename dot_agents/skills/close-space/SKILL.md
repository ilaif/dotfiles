---
name: close-space
description: Close a Herdr workspace created by new-space (local or on a remote Herdr machine) — stop its processes, remove its git worktree and local branch, and close the workspace. Use when the user asks to close, finish, or clean up a space or worktree.
---

# close-space

The argument names one or more spaces: a workspace label, workspace ID, branch slug, or worktree path. No argument means the current workspace. A leading `@<where>` names a remote Herdr machine. Make **one** tool call — the script; don't check `HERDR_ENV`, list workspaces, or run git first.

```bash
node ~/.claude/skills/close-space/close-space.ts [--machine <where>] [<space> ...]
```

The script checks everything before touching anything, then per space: stops processes whose command line references the worktree (skipping your own process ancestry), removes the worktree (pruning if git already forgot it), deletes the local branch, and closes the workspace. Remote branches and PRs are left alone. Never hand the removal to a repo's own worktree wrapper (e.g. `dx wt rm`): its orphan sweep can kill its own parent.

## Exit codes

- **1 — `close-space preflight failed:`** every problem at once, each with its fix. No match / several matches: show the candidates and ask. Machine not saved or unreachable: follow the line (see new-space), or relay it and stop.
- **2 — `close-space needs confirmation:`** a dirty tree, unpushed commits, a working agent, or a main checkout (nothing to remove, only the workspace closes). Show the listed details in a few lines and ask. On yes, rerun with `--force` for just the confirmed spaces (`--force` also forces `git worktree remove`).
- **0** — one `closed …` line per space; relay them.

## After it succeeds

- `CLOSE LAST (ends this session): herdr workspace close <id>` — the target is the workspace you are running in. Send your report first, then make that command your last call.
- `LAST SPACE on <machine>` — ask what to do with the Podium workspace: keep it (the default), stop it (`dx ws stop <name>`; volumes persist), or delete it (`dx ws rm <name> --yes`, which also forgets its Herdr machine). Run `dx` from the act checkout, and delete only on an explicit answer.

`--dry-run` shows what would close without changing anything.
