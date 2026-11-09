---
name: update-dotfiles
description: Sync home-directory config with the chezmoi dotfiles repo — find drift between ~ and the repo and new untracked configs worth tracking, suggest a sync direction per file, sync with chezmoi, then commit and push. Use when the user asks to update, sync, or back up dotfiles.
---

# update-dotfiles

Source repo: `chezmoi source-path` (ilaif/dotfiles, **public**). Run chezmoi from `~`.

## 1. Pull

```bash
git -C "$(chezmoi source-path)" pull --ff-only
```

## 2. Map drift in managed files

```bash
chezmoi status
chezmoi diff <path>    # per M entry; "-" is the machine, "+" is the repo
```

Ignore `R` rows (run scripts). For each `M` file, read the diff and classify it:

- **Machine → repo** (default; the machine wins): a plain source file gets `chezmoi add <path>`.
- **Repo → machine**: only when the repo side is clearly newer, e.g. a commit pulled in step 1 touched it. Use `chezmoi apply <path>`.
- **Template sources** (`.tmpl`, `modify_`, check with `chezmoi source-path <path>`): never `chezmoi add`. Port the machine's change into the template, or into the file it includes (`claude-settings.json` for `~/.claude/settings.json`). Ignore whitespace-only or trailing-newline diffs.

## 3. Find new configs worth tracking

```bash
chezmoi unmanaged . | grep '^\.' | grep -v /
chezmoi unmanaged .config .claude .agents .codex
```

Inside managed dirs (e.g. `.config/herdr/plugins/<plugin>`), also look for files a manifest or settings entry references that the repo is missing.

**Suggest** hand-written config: rc files, tool settings, your own hooks and scripts that `settings.json` or plugin manifests call.

**Skip**:
- Secrets and auth (`gh/hosts.yml`, `.ssh`, `.aws`, `.secrets`, tokens, `.custom_aliases`).
- **Work-related content.** The repo is public, so nothing about Act Security goes in: internal endpoints, the act repo's tooling (`dx`, Podium, Tilt, Temporal), tenants, work cloud accounts. `~/.claude/CLAUDE.local.md` and `~/.config/opencode/opencode.jsonc` are work files. Grep each candidate for `act|azure|aws|podium|tenant|token|secret` before suggesting it.
- Files a tool writes and owns (headers like "managed by herdr", lockfiles, `plugins.json`).
- Runtime state, logs, sockets, sessions, caches, `__pycache__`, `.bak*` and backup files, history files.

## 4. Propose, then wait

Show one short table: path, drift or new, suggested direction, and why. Add a "skipped" line per category above. Wait for the user's approval or edits before changing anything.

## 5. Sync

Run the approved `chezmoi add`, `chezmoi apply` and template edits. Then check:

```bash
chezmoi status     # only R rows and ignored diffs left
```

For a template you edited, show the rendered output is a no-op on the live file (`chezmoi diff <path>`).

Claude settings hooks: `modify_settings.json.tmpl` merges with jq `*`, which **replaces arrays**. Never put `hooks` in `claude-settings.json`. Add a missing hook to that template's `$hooks` list instead, which appends it per event only when it's missing.

## 6. Sensitive-content check, then commit and push

The repo is public, so scan before committing: the staged diff, and the whole tracked tree.

```bash
cd "$(chezmoi source-path)"
git diff --stat
PAT='act\.security|actsec|azure|aws|podium|tenant|secret|token|password|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[bap]-|ghp_|sk-[A-Za-z0-9]{20,}|@act\.|internal|corp'
git diff | grep -niE "$PAT"                      # staged/unstaged changes
git grep -niE "$PAT" -- . ':!Brewfile'           # whole tracked tree
gitleaks detect --no-banner --redact             # secrets across history
```

Triage each hit as benign (generic word, public tool name) or sensitive (credential, internal endpoint, Act-specific tooling, tenant or account ID, work email). Remove or exclude every sensitive hit before committing.

```bash
git add -A && git commit -m "<what changed, by area>" && git push
```

Report the commit hash, what was synced in each direction, and anything you left out and why. Always end with an explicit **Sensitive-content check** line:

- Clean: "Sensitive-content check: clean. Scanned the diff, N tracked files and history (gitleaks); no credentials or company-specific content. M benign hits (list them in a few words)."
- Not clean: list each finding with file and line, and say what you did about it. Do not push until resolved or the user approves.
