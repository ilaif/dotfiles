#!/usr/bin/env bash
# Runs inside the `close-worktree` split pane opened by close.sh.
# Remove the dev-space's worktree with plain git, then close the
# space. Works on any repo:
#   1. confirm; a dirty tree asks again before --force
#   2. kill orphaned processes whose command line references the worktree
#      (never this script's own ancestry)
#   3. git worktree remove [--force]; prune if git already dropped it
#   4. delete the branch the worktree held
# A grouped worktree (a dir holding one linked worktree per repo, marked by
# .group-worktree.json) removes every member, then the group dir.
#
# Cancel at any prompt closes the helper pane and leaves the space open; a failure
# keeps the helper pane open with the error until Enter. Everything runs from outside
# the tree being removed.
set -uo pipefail

herdr="${HERDR_BIN_PATH:-herdr}"
self_ws="${DEVSPACE_WS:-${HERDR_WORKSPACE_ID:-}}"
GROUP_MARKER=".group-worktree.json"

cancel() {
  echo "${1:-Cancelled}" >&2
  sleep 1
  exit 1
}

fail() {
  echo >&2
  echo "dev-space: ${1:-Removal failed}" >&2
  read -r -p "Press Enter to close." _
  exit 1
}

confirm() {
  local prompt="$1" default="${2:-n}" ans
  read -r -p "$prompt " ans
  ans="${ans:-$default}"
  [[ "$ans" =~ ^[Yy]$ ]]
}

# ---- 1. locate the worktree for this pane's cwd ---------------------------
cwd="${DEVSPACE_CWD:-${PWD:-$HOME}}"
[[ -d "$cwd" ]] || cancel "No usable cwd"
git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || cancel "Not a git repo: $cwd"

repo_root="$(git -C "$cwd" rev-parse --show-toplevel)"
main_repo_root="$(cd "$(dirname "$(git -C "$repo_root" rev-parse --git-common-dir)")" && pwd)"

if [[ "$main_repo_root" == "$repo_root" ]]; then
  # A main checkout has no worktree to remove; ~/git/act just closes its space.
  if [[ "$repo_root" == "$HOME/git/act" ]]; then
    [[ -n "$self_ws" ]] && "$herdr" workspace close "$self_ws" >/dev/null 2>&1
    exit 0
  fi
  cancel "Refusing to remove the main checkout: $repo_root"
fi

# A grouped worktree removes the whole group; otherwise just this tree.
group_dir=""
if [[ -f "$(dirname "$repo_root")/$GROUP_MARKER" ]]; then
  group_dir="$(dirname "$repo_root")"
  target_name="$(basename "$group_dir")"
  target_dir="$group_dir"
else
  target_name="$(basename "$repo_root")"
  target_dir="$repo_root"
fi

cd "$main_repo_root" || fail "Cannot cd to main checkout $main_repo_root"

confirm "Remove worktree '$target_name'? (y/N)" || cancel "Aborted"

# ---- 2. dirty check -------------------------------------------------------
member_worktrees() {
  if [[ -n "$group_dir" ]]; then
    local d
    for d in "$group_dir"/*/; do
      d="${d%/}"
      [[ -e "$d/.git" ]] && printf '%s\n' "$d"
    done
  else
    printf '%s\n' "$repo_root"
  fi
}

force=()
dirty=""
while IFS= read -r wt; do
  [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]] && dirty+="  $wt"$'\n'
done < <(member_worktrees)
if [[ -n "$dirty" ]]; then
  echo "Uncommitted changes in:" >&2
  printf '%s' "$dirty" >&2
  confirm "Force remove? (y/N)" || cancel "Aborted"
  force=(--force)
fi

# ---- 3. orphaned processes ------------------------------------------------
# Own ancestry (this shell, the herdr pane, ...) is excluded: a process that
# references the tree only because it is running this removal must survive it.
ancestors() {
  local pid=$$
  while [[ "$pid" -gt 1 ]]; do
    printf '%s\n' "$pid"
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -z "$pid" ]] && break
  done
}

# The path travels via the environment so the sweep's own awk never matches.
orphaned_procs() {
  local skip
  skip="$(ancestors | paste -sd'|' -)"
  ps -axo pid=,pcpu=,pmem=,command= | WT_DIR="$target_dir" awk -v skip="^(${skip})$" '
    index($0, ENVIRON["WT_DIR"]) && $1 !~ skip { print }'
}

procs="$(orphaned_procs)"
if [[ -n "$procs" ]]; then
  echo "Processes referencing $target_dir:"
  printf '%s\n' "$procs" | awk '{ pid=$1; cpu=$2; mem=$3; $1=$2=$3=""; sub(/^ +/, ""); printf "  %-7s %5s%% %5s%%  %.90s\n", pid, cpu, mem, $0 }'
  if confirm "Kill $(printf '%s\n' "$procs" | wc -l | tr -d ' ') process(es)? (Y/n)" y; then
    while read -r pid _; do kill -TERM "$pid" 2>/dev/null || true; done <<<"$procs"
    sleep 0.5
  fi
fi

# ---- 4. git worktree remove + branch --------------------------------------
registered() {
  git -C "$1" worktree list --porcelain 2>/dev/null | grep -qx "worktree $2"
}

# Remove linked worktree $1 from its main checkout and delete the branch it held.
remove_one() {
  local wt="$1" main branch
  main="$(cd "$(dirname "$(git -C "$wt" rev-parse --git-common-dir 2>/dev/null)")" 2>/dev/null && pwd)"
  [[ -z "$main" || "$main" == "$wt" ]] && { echo "Not a linked worktree: $wt" >&2; return 1; }
  branch="$(git -C "$wt" branch --show-current 2>/dev/null)"

  echo "==> git worktree remove ${force[*]} $wt"
  if ! git -C "$main" worktree remove "${force[@]}" "$wt"; then
    registered "$main" "$wt" && { echo "git worktree remove failed for $wt" >&2; return 1; }
    git -C "$main" worktree prune >/dev/null 2>&1 || true
  fi

  if [[ -n "$branch" ]]; then
    echo "==> git branch -D $branch"
    if ! git -C "$main" branch -D "$branch" 2>/dev/null \
       && git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
      echo "warning: could not delete branch $branch" >&2
    fi
  fi
  return 0
}

failed=()
while IFS= read -r wt; do
  remove_one "$wt" || failed+=("$wt")
done < <(member_worktrees)

if [[ ${#failed[@]} -gt 0 ]]; then
  fail "Could not remove: ${failed[*]}"
fi
if [[ -n "$group_dir" ]]; then
  rm -rf "$group_dir" || fail "Could not delete group dir $group_dir"
fi
echo "Worktree removed: $target_name"

# ---- 5. close the space ---------------------------------------------------
if [[ -n "$self_ws" ]]; then
  "$herdr" workspace close "$self_ws" >/dev/null 2>&1 || true
else
  read -r -p "Press Enter to close." _
fi
