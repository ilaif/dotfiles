---
name: new-space
description: Create a git worktree, open it as a Herdr workspace, and fire-and-forget a coding agent on a task in it — locally or on a remote Herdr machine (`@<machine>`, "in workspace X"). Use when the user asks to start work in a new space, worktree, or parallel session.
---

# new-space

The argument is the task. Parse and slugify in your head, then make **one** tool call: the script (two when a model is named, see below). Don't check `HERDR_ENV`, list machines, or inspect the repo first — the script's preflight does all of that.

## 1. Parse

A leading `@<where>`, or naming a remote workspace in words ("in workspace abc-123", "on abc-123"), picks that remote machine; otherwise the space is local. Then an agent name followed by `:` is an override (`claude`, `codex`, `pi`, `opencode`, `omp`); anything else is all task. Default agent: `claude`.

A model named before the task, such as "opus model:" or "with the fast sonnet", goes to `--model`, not the task. First list what the agent accepts:

```bash
node ~/.claude/skills/new-space/new-space.ts --list-models --agent <agent> [--machine <where>]
```

It prints one `<id>\t<label>` line per model. Pick the line that best matches what the user said and pass its exact `<id>` to `--model`. Several plausible matches: list them and ask. None: relay the list and stop. No model named: skip the listing and omit the flag.

`codex: fix the flaky auth test` → local, agent `codex`, task `fix the flaky auth test`.
`opus model: fix the flaky auth test` → local, agent `claude`, `--list-models`, then model `opus`, task `fix the flaky auth test`.
`@abc-123 claude: fix the flaky auth test` or `open a new space in workspace abc-123 to fix the flaky auth test` → remote machine `abc-123`.

## 2. Slugify

Slugify the task into a branch name, leading with the ticket ID if the task names one (`abc-123-<rest>`).

## 3. Run the script

```bash
node ~/.claude/skills/new-space/new-space.ts --slug <slug> --agent <agent> --task "<task>" [--model <id>] [--machine <where>]
```

Pass `<where>` as the user wrote it; the script matches it against each saved Herdr machine's label, the label after `/`, or the SSH target's last dot-separated part.

**Preflight.** Before touching anything, the script checks every prerequisite (inside Herdr, `herdr` and the agent CLI on PATH, machine match / enabled / reachable, git repo, `origin`, `origin/HEAD`) and on failure exits 1 with a `new-space preflight failed:` list — every problem at once, each with its fix. Fix what you can and rerun once:

- No machine match: follow `~/.claude/CLAUDE.local.md` to save the machine, then rerun. No instructions there: relay and stop.
- Several matches: list them, ask which, rerun with the full label.
- Anything that needs the user (not inside Herdr, `herdr machine reconnect`): relay the line and stop.

**Run.** It fetches and bases on the default branch, creates the worktree as a sibling of the repo (`~/git/<slug>`, retrying `-2`, `-3`, … on collision), splits a 10% bottom terminal, launches the agent in the root pane, submits the task as a prompt, then runs the repo's worktree setup in the bottom pane. Local runs use the repo of the current directory; remote runs use the machine's main checkout. The branch stays local — the spawned agent owns pushing.

## 4. Report

Relay the script's one-line output (machine, workspace label and ID, worktree path, branch, agent command with its model). Then **fire and forget**: treat the spawned agent as out of scope for the rest of the session. Inspect it only if the user asks.
