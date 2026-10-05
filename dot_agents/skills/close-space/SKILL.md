---
name: close-space
description: Close a Herdr workspace created by new-space (local or on a remote Herdr machine) — stop its processes, remove its git worktree and local branch, and close the workspace. Use when the user asks to close, finish, or clean up a space or worktree.
---

# close-space

The argument names one or more spaces: a workspace label, workspace ID, branch, or worktree path. No argument means the current workspace (`$HERDR_WORKSPACE_ID`). Run the whole sequence per space in one pass.

Requires `HERDR_ENV=1` — if unset, say you are not inside Herdr and stop.

A leading `@<machine>` names a remote Herdr machine, resolved from `herdr machine list --json` as in new-space. For it, every `herdr` command below takes the `--machine <label>` prefix and every shell command (`git`, `ps`, `kill`) runs as `ssh <target> '<command>'`; `$HERDR_WORKSPACE_ID` never refers to a remote space.

## 1. Resolve

```bash
herdr workspace list
```

Match the argument against `label`, `workspace_id`, or `worktree.checkout_path` / its basename (the branch slug, per new-space). Take the worktree path from `worktree.checkout_path` and the branch from `git -C <path> branch --show-current`. No match or several matches: list the candidates and ask.

`worktree.is_linked_worktree` false (a main checkout such as `~/git/myrepo`) or no `worktree` at all: there is nothing to remove — only close the workspace (step 5), after confirming.

## 2. Check what would be lost

Run from the main checkout (`dirname $(git -C <path> rev-parse --git-common-dir)`), never from inside the tree being removed:

```bash
git -C <path> status --porcelain
git -C <main> log --oneline <branch> --not --remotes
```

Also note the workspace's `agent_status`.

- Clean tree, no unpushed commits, agent not `working`: the request is the authorization — proceed.
- Otherwise: show the dirty files, the unpushed commits, and the working agent in a few lines, and ask before continuing. A yes on dirty files means `--force` in step 4.

## 3. Stop processes using the tree

Kill processes whose command line references the worktree path — dev servers, watchers, Tilt, `tsx`, the space's agent — except your own ancestry, so a session running inside that space survives until step 5:

```bash
skip="$(pid=$$; while [ "$pid" -gt 1 ]; do echo "$pid"; pid=$(ps -o ppid= -p "$pid" | tr -d ' '); done | paste -sd'|' -)"
ps -axo pid=,command= | WT_DIR="<path>" awk -v skip="^(${skip})$" 'index($0, ENVIRON["WT_DIR"]) && $1 !~ skip { print $1 }' | xargs kill -TERM
```

The path travels via the environment so the awk itself never matches. Don't hand this to a repo's own worktree-removal wrapper: an orphan sweep in such a tool can kill its own parent and leave a half-deleted tree.

## 4. Remove the worktree and branch

```bash
git -C <main> worktree remove [--force] <path>
git -C <main> branch -D <branch>
```

If `worktree remove` fails but the path is no longer listed in `git -C <main> worktree list`, run `git -C <main> worktree prune` and continue. Leave remote branches and PRs alone.

## 5. Close the workspace, report

Report the closed workspace label, removed path, and deleted branch in one line, then close it:

```bash
herdr workspace close <workspace-id>
```

When the target is the workspace you are running in, closing it ends this session — send the report first and make the close the last call.
