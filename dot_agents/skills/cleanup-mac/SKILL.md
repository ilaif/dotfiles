---
name: cleanup-mac
description: Free macOS disk space — disk full, low space, or a GB target. Measures real usage, then clears caches, Docker and local clusters, old versions, unused apps and orphan volumes, with approval before anything that holds data.
argument-hint: "[target GB] [--dry-run]"
compatibility: macOS (APFS). dust, docker/OrbStack, mise, pnpm optional. sudo steps go to the user.
---

# Cleanup Mac

Measure → propose → approve → delete → re-measure. `--dry-run` stops at the proposal. Every GB figure you report is a `df -k` diff: that is **real** space. A `du` total is a claim until a `df` diff confirms it.

## 1. Measure

```bash
df -h /System/Volumes/Data
diskutil apfs list | grep -E 'Name:|Capacity Consumed|Role' | paste - - -
dust -d 1 -n 15 -x ~ ; dust -d 1 -n 10 ~/Library ~/Library/Application\ Support ~/Library/Group\ Containers
docker system df
```

Watch for **phantom** space, where `du` counts blocks that other files share:
- **`~/git` is mostly phantom.** pnpm hardlinks to its store and APFS clones count in full in every worktree. 176GB of `du` freed ~9GB when 8 worktrees went; stripping one worktree's `node_modules` freed 0GB.
- Before you quote a yield for any large folder you suspect, delete one disposable sample and diff `df -k`.

Usage that `dust ~` misses:
- **Separate APFS volumes**: an orphan `Nix Store`, and the `VM` swap volume (a reboot resets it).
- **OrbStack**: `~/Library/Group Containers/HUAQ24HBR6.dev.orbstack`, mostly k3d volumes.

**Done:** every candidate over 1GB has a real (or sample-verified) yield, and the phantom ones are labelled.

## 2. Propose

Rank the tiers by real yield for this machine. The yields below are from one 460GB dev Mac; use them for ordering only.

| Tier | What | Yield | Approval |
| --- | --- | --- | --- |
| Caches | `~/Library/Caches/*`, `~/.cache/*`, `~/.npm/_cacache`, `go clean -modcache`, `pnpm store prune`, `mise prune -y && mise cache clear`, Claude `vm_bundles`/`Cache`/`Code Cache`, Electron apps' `Cache`/`Code Cache`/`GPUCache`/`Service Worker` | ~40GB | user's go |
| Docker | `docker image prune -af`, `docker builder prune -af`, `docker exec <k3d-server-container> crictl rmi --prune` | ~11GB | user's go |
| Old versions | `~/.codex/packages/*/releases/*` except the one `current` links to; `~/Library/Application Support/JetBrains/<IDE><old-version>` | ~8GB | user's go |
| Local cluster reset | the repo's own teardown for its k3d/kind dev cluster (fallback `k3d cluster delete`), then `docker system prune -af --volumes` | ~21GB | explicit: wipes local databases and seed data; the repo's bring-up rebuilds it |
| Unused apps | `/Applications/<app>.app` plus `~/.<app>`, `Application Support`, `Preferences`, `Saved Application State` | ~13GB | explicit, multi-select per group (`kMDItemLastUsedDate` is mostly null) |
| Orphan volumes | `sudo diskutil apfs deleteVolume <disk>`, once `/etc/fstab`, `/etc/synthetic.conf`, LaunchDaemons and `_nixbld` users show no reference | ~14GB | explicit |
| User files | `~/Movies`, `~/Downloads`, libraries left behind by deleted apps | varies | explicit, per folder |
| Worktrees | `/cleanup-worktrees` | small (phantom) | its own gate |
| Reboot | frees the `VM` swap volume | ~15GB | the user's choice |

Some data can only be shrunk from inside the app. Offer it; don't delete it:
- **Zoom**: `Application Support/zoom.us` holds the chat database. Wipe only `AutoUpdater`, `data/ZoomAppCache` and `Logs/zoom.us`.
- **Arc / Chrome profiles**: history and site data. Clear them in the browser's settings.
- **Notion offline data**: sign out and back in.
- **Keep the app, reset its data** (e.g. Cursor): delete its data folders and leave the `.app`.

**Gate:** "user's go" tiers run on a single go. Explicit tiers need their exact items named in the user's approval.

## 3. Apply

Run tier by tier, diffing `df -k` around each one.
- Quit an app (`osascript -e 'tell application "X" to quit'`) before wiping its caches or data. List the apps to reopen in the report.
- Put deletes that use globs in a bash script. zsh aborts the whole command on any unmatched glob.

Hand these to the user as one combined `!` command or a Finder step:
- **sudo**: this shell has no TTY to type a password.
- **App Store apps** (iMovie, GarageBand, iWork) refuse `rm`. Use Finder: ⌘⇧A, select, ⌘⌫.

**Done:** free space before → after, freed GB per tier, what was kept and why, apps to reopen, and the remaining options ranked by real yield.
