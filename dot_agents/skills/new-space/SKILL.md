---
name: new-space
description: Create a git worktree, open it as a Herdr workspace, and fire-and-forget a coding agent on a task in it. Use when the user asks to start work in a new space, worktree, or parallel session.
---

# new-space

The argument is the task. Run the whole sequence in one pass.

Requires `HERDR_ENV=1` — if unset, say you are not inside Herdr and stop.

## 1. Parse

An agent name followed by `:` at the very start is an override (`claude`, `codex`, `pi`, `opencode`, `omp`); anything else is all task. Default agent: `claude`.

`codex: fix the flaky auth test` → agent `codex`, task `fix the flaky auth test`.

## 2. Create the worktree workspace

Slugify the task into a branch name, leading with the ticket ID if the task names one (`abc-123-<rest>`).

Worktrees are siblings of the repo, never nested inside it: for a repo at `~/git/myrepo`, the path is `~/git/<slug>`, bare — no user or repo prefix.

```bash
herdr worktree create --cwd <repo-root> --branch <slug> --base <default-branch> --path <parent>/<slug> --label <slug> --no-focus
```

`--no-focus` keeps the user in their current pane. Read `result.workspace.workspace_id` and the pane ID from the JSON response rather than guessing; `herdr pane list --workspace <id>` also has the pane.

The branch stays local — no upstream, no push. The spawned agent owns that call.

On a path or branch collision, retry with `-2`, `-3`, … appended to both.

## 2.5. Run the repo's worktree setup, if any

A fresh worktree is missing git-ignored local files (env, keys). Run whichever setup the repo ships, in the new worktree;
skip silently when there is none.

- `scripts/setup-worktree.sh` present: run it synchronously. A repo with slow steps
  (dependency install, build) should detach them inside this script, so the agent starts
  against a usable tree.
- `package.json` has a `setup-worktree` script: run it in the background, logging to
  `.worktree-setup.log`.

```bash
cd <worktree-path>
[ -f mise.toml ] && mise trust
if [ -x scripts/setup-worktree.sh ]; then
  ./scripts/setup-worktree.sh
elif node -e 'process.exit(require("./package.json").scripts?.["setup-worktree"] ? 0 : 1)' 2>/dev/null; then
  nohup npm run setup-worktree > .worktree-setup.log 2>&1 &
fi
```

## 3. Add the bottom terminal pane

Split a shell pane across the bottom of the workspace, sized to 10%:

```bash
herdr pane split <root-pane-id> --direction down --ratio 0.9 --cwd <worktree-path> --no-focus
```

`--ratio` sizes the **original** pane, not the new one — `0.9` leaves the agent 90% and the new bottom terminal 10%. Split before launching the agent so its TUI starts at the final size.

## 4. Launch, submit, report

Start the agent's bare interactive executable in the **root pane** (not the bottom terminal) — the task goes in as a prompt, never as argv:

```bash
herdr pane run <root-pane-id> "<agent>"
herdr agent wait <root-pane-id> --until idle --timeout 60000
herdr pane run <root-pane-id> "<task>"
```

The `idle` wait is what keeps the prompt from being typed into a TUI that has not started yet.

Then **fire and forget**: report the workspace label and ID, worktree path, branch, and agent in one or two lines, and treat the spawned agent as out of scope for the rest of the session. Inspect it only if the user asks.
