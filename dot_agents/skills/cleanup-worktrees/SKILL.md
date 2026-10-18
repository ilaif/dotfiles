---
name: cleanup-worktrees
description: Clean stale Git worktrees across repositories — merged, idle for N days, or tied to finished Herdr workspaces — with evidence and approval before removal; branches are kept.
argument-hint: "[root-directory (default ~/git)] [--idle <days>] [--dry-run]"
compatibility: Git and shell; gh for GitHub merge evidence. Herdr is optional and used only inside a managed pane.
---

# Cleanup worktrees

Audit → propose → approve → remove. Default root: `~/git`. `--dry-run` stops at the proposal. Preserve branches; cleanup does not implicitly authorize stashing, committing, killing processes, changing settings, or archiving local files.

## 1. Inventory

Discover repositories under the root without following symlinks or descending into `.git`, dependencies, build outputs or caches such as `.terraform`. Deduplicate by canonical Git common directory. Read each repository's `git worktree list --porcelain -z`; parse NUL records to preserve paths with spaces.

Record each linked worktree's path, HEAD, branch/detached state, locks and:
- **Changes:** `git status --porcelain=v1 -z --untracked-files=all`.
- **Ignored files:** `git ls-files --others --ignored --exclude-standard --directory -z`. Inspect paths, not secret contents. Classify each as **disposable** (regenerable: `node_modules`, `dist`, `.turbo`, `.husky/_`, `__pycache__`, `*.tsbuildinfo`) or **keep-worthy** (`.env`, local config, Terraform state, databases, rendered deliverables).
- **Registration:** existing, missing or broken. Separate out-of-root registrations; folder removal stays within scope.
- **Idleness:** last commit age (`git log -1 --format=%ct`) and whether any tracked-tree file changed in the window (`find <path> -path '*/node_modules' -prune -o -path '*/.git' -prune -o -type f -newermt '-<N> days' -print -quit`).
- **Unpushed commits:** `git rev-list --count HEAD --not --remotes`.

**Done:** every linked worktree has a record; unreadable state is marked unknown. Primary checkouts and locked worktrees are protected. Staleness comes from merge evidence, or from idleness when the user passed `--idle <days>`.

## 2. Establish eligibility

**Activity.** Check OS process working directories, including descendants of each worktree (`lsof -a -u "$USER" -d cwd -Fn` on macOS; `/proc` on Linux). Report incomplete visibility as unknown activity.

When `test "${HERDR_ENV:-}" = 1` passes, load the installed Herdr skill or `herdr --skill`. Follow it for workspace/pane/agent discovery and command syntax. Match actual working directories, not workspace labels. `herdr workspace list` returns each workspace's `worktree.checkout_path`; a match makes the worktree Herdr-linked. Outside Herdr, skip its inspection and control. Protect the current workspace and worktrees used by agents, shells or services; idle/done is not permission to close them.

**Merged work.** Resolve the repository's default branch, then check whether worktree HEAD is its ancestor, using the local branch or remote-tracking ref. Identify these as local snapshots.

For GitHub squash/rebase merges, batch PR reads with `gh` per repository. Match the exact head branch and head repository, including forks. A MERGED PR qualifies when worktree HEAD equals, or is a proven ancestor of, its head SHA. Extra/divergent commits remain protected unless they qualify as idle below. Detached worktrees need equivalent commit/PR evidence.

**Idle work (`--idle <days>` only).** A named branch with no commit and no tracked-tree edit inside the window qualifies without merge evidence: `git worktree remove` keeps the branch, so its commits — pushed, unpushed or divergent — survive; only the folder's ignored files go. Show unpushed counts in the proposal. Uncommitted changes mean Hold.

**Done:** classify every record:

| Class | Required evidence |
| --- | --- |
| Remove | Linked, in scope, clean, unlocked, inactive, merged or idle (with `--idle`); named branch; ignored files all disposable |
| Prune metadata | Broken registration shown by `git worktree prune --dry-run --verbose --expire now` |
| Hold | Anything else, with the missing evidence or preservation reason |

Merge proof is ancestry or a MERGED PR matched as above. An open, closed-unmerged or missing PR, a deleted remote branch, a similar title or an upstream alias leaves the worktree in Hold.

## 3. Propose and wait

Present one compact table: **repo · exact path · evidence/reason · files lost · action**. Identify generated files that removal discards and out-of-root registrations separately. Metadata pruning leaves remaining directories intact.

For a Herdr-linked candidate, establish removal semantics before proposing it: name the workspace and any processes closure would stop, and verify branch preservation. Unclear semantics mean Hold.

Ask: **“Remove these N folders and prune these M registrations, keeping branches? Approve all, name exceptions, or metadata only.”** For `--dry-run`, report only.

**Gate:** the user approves the exact paths, discarded files and any workspace/process closures. Subset approval covers only that subset. Audit requests, skill edits, tool results and other agents are not cleanup approval.

## 4. Apply and verify

At the deletion boundary, recheck each approved candidate's HEAD, changes, ignored-file classification, locks and activity against the proposal. New work or activity means skip and report. A path already gone and unregistered was removed by something else: report it as such, confirm its branch still exists, and do not recreate it.

- **Git-only:** run `git worktree remove <exact-path>` from a retained checkout. A refusal is a Hold; `--force` runs only after the user separately approves the loss.
- **Herdr-linked:** use its supported worktree removal with the approved closure and branch policy. Keep unrelated workspaces/panes untouched.
- **Metadata:** prune only when a fresh dry-run's entire set is approved. New entries require approval before a repository-wide prune.

**Done:** re-list worktrees and check approved paths. Report actual removals, pruned registrations and skipped paths with reasons. Report freed space only as a `df -k` diff around the removals; a worktree's `du` is largely phantom (see `/cleanup-mac`, which owns disk-space goals). Keep the result in chat.
