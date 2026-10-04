# Dotfiles

## Agent skills

Chezmoi deploys `dot_agents/skills/` to `~/.agents/skills/`. The source file `dot_claude/symlink_skills` creates `~/.claude/skills → ../.agents/skills`. These directories are non-exact, so other installed skills are preserved.

Check the configured source before syncing:

```sh
chezmoi source-path
chezmoi diff
```

To preview this checkout explicitly without changing the configured source:

```sh
chezmoi --source "$PWD" diff
```

Review differences before applying them. Use chezmoi, rather than a second installer, to manage these skills.

`/cleanup-worktrees [root-directory] [--dry-run]` audits Git worktrees (default `~/git`), checks Herdr activity inside Herdr, and asks before removing folders or pruning registrations. Branches and unfinished work are preserved.

## Getting started

1. First things first, setup various mac settings: `make mac-setup`
2. Bootstrap chezmoi to install all dotfiles and dev packages: `make bootstrap-chezmoi`

## To pull the latest changes and apply them

```sh
chezmoi update
```

## Daily commands - for using chezmoi

```sh
chezmoi add $FILE           # adds $FILE from your home directory to the source directory.
chezmoi edit $FILE          # opens your editor with the file in the source directory that corresponds to $FILE.
chezmoi status              # gives a quick summary of what files would change if you ran chezmoi apply.
chezmoi diff                # shows the changes that chezmoi apply would make to your home directory.
chezmoi apply               # updates your dotfiles from the source directory.
chezmoi edit --apply $FILE  # is like chezmoi edit $FILE but also runs chezmoi apply $FILE afterwards.
chezmoi cd                  # opens a subshell in the source directory.
```

## Homebrew packages

`Brewfile` is the package baseline, copied from the current `~/Brewfile`. Devbox global package management is retired; existing local Devbox installations are not removed.

Edit `Brewfile` to review package changes. The install hook runs `brew bundle --force --file="$HOME/Brewfile"`; because it is a non-template `run_onchange` hook, changing only `Brewfile` does not retrigger it after its first run. Run the bundle command explicitly when you intend to install changed packages.

## Local-only settings

Git name and email remain chezmoi's `gitUser` and `gitEmail` data, not fixed personal details. The Git credential helper resolves `gh` from `PATH` and retrieves credentials at runtime.

The database secret helpers require `RDS_DEV_SECRET_ID`, `RDS_PROD_USE1_SECRET_ID`, and `RDS_PROD_EUC1_SECRET_ID` in local-only `$HOME/.secrets/env` (already sourced by `.zshrc`). Set each variable to the relevant secret ID locally. The helpers retrieve the password at runtime using the active AWS credentials. Do not commit that file or any secret values or identifiers. No local settings file is created by this consolidation.

## Review before applying

This consolidation changes source files only. A future broad apply or bootstrap is not a preferences-only operation: existing hooks install/update Homebrew packages, authenticate/install GitHub extensions, install global pnpm packages, reset the tmux symlink, and create/touch `$HOME/.secrets/env`. Bootstrap uses `init --apply`; `make mac-setup` changes system settings. None of these operations is needed for source review.

The refresh hook creates `$HOME/.secrets/env`, the file the shell sources. The current home `docker-prune` alias is preserved, including forced removal of all Docker images. Review it before using it.

The Homebrew baseline is intentionally not expanded to cover every current shell/editor dependency (for example, Delta, mise, aws-sso, bun, and Claude Code). The shell also retains a version-specific `claude-mem` plugin path under `$HOME`; review installed-tool availability and that path on other machines.
