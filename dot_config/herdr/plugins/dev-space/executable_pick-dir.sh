#!/usr/bin/env bash
# Runs inside the dev-space's first pane. Flow:
#   1. Pick a directory (fzf over zoxide frecent dirs + git checkouts), or take
#      it from $1 when the caller already knows which repo to act on.
#   2. If it's a git repo, choose one of:
#        - open it as-is
#        - new worktree on a new branch (type a name, then pick a base ref)
#        - new worktree on an existing branch (pick a local or remote branch)
#        - open one of the repo's existing worktrees
#   3. Build the preset layout in the target space:
#        claude (left, 40%, terminal below at 15% height)  |
#        nvim above review pane (right, 60%, 50/50)
# Cancel at any prompt leaves a plain shell in this pane.
set -uo pipefail

herdr="${HERDR_BIN_PATH:-herdr}"
self="${HERDR_PANE_ID:-}"
self_ws="${self%%:*}"

jget() { grep -o "\"$2\":\"[^\"]*\"" <<<"$1" | head -n1 | sed 's/.*:"//;s/"$//'; }

# Build the claude|nvim/review layout: $1 = pane to become claude, $2 = cwd.
# Splits siblings, launches nvim + review pane + a term under claude, focuses claude,
# then hands $1 to claude.
build_layout() {
  local claude_pane="$1" dir="$2" split_json right_pane bottom_json bottom_pane term_json term_pane
  split_json="$("$herdr" pane split "$claude_pane" --direction right --ratio 0.6 --no-focus --cwd "$dir")"
  right_pane="$(jget "$split_json" pane_id)"
  if [[ -n "$right_pane" ]]; then
    bottom_json="$("$herdr" pane split "$right_pane" --direction down --ratio 0.5 --no-focus --cwd "$dir")"
    bottom_pane="$(jget "$bottom_json" pane_id)"
    "$herdr" pane run "$right_pane" "nvim ." >/dev/null 2>&1 || true
  fi
  term_json="$("$herdr" pane split "$claude_pane" --direction down --ratio 0.85 --no-focus --cwd "$dir")"
  term_pane="$(jget "$term_json" pane_id)"
  [[ -n "$term_pane" ]] && "$herdr" pane rename "$term_pane" "term" >/dev/null 2>&1 || true
  "$herdr" pane focus --pane "$claude_pane" >/dev/null 2>&1 || true
}

bail() { echo "${1:-Cancelled} - staying in a shell here." >&2; exec "${SHELL:-/bin/zsh}"; }

# Open a fresh space at $1 labelled $2, lay it out, start claude, and discard
# this picker space. Never returns.
open_space() {
  local dir="$1" label="$2" ws_json claude_pane
  ws_json="$("$herdr" workspace create --cwd "$dir" --label "$label" --focus)"
  claude_pane="$(jget "$ws_json" pane_id)"
  [[ -z "$claude_pane" ]] && bail "Could not open space at $dir"
  build_layout "$claude_pane" "$dir"
  "$herdr" pane run "$claude_pane" "claude" >/dev/null 2>&1 || true
  [[ -n "$self_ws" && "$self_ws" != "${claude_pane%%:*}" ]] && "$herdr" workspace close "$self_ws" >/dev/null 2>&1
  exit 0
}

# Sibling worktree dir name: the branch name as a DNS-1123 label, matching
# `dx wt add` and the repo's worktree hooks.
wt_dirname() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//' | cut -c1-63 | sed -E 's/-+$//'
}

# Create a worktree for branch $1 and echo its path. $2 is the base ref to
# branch off, or empty when $1 is an existing branch to check out as-is.
# The branch keeps the name as given (slashes and all) while the directory is
# the normalized sibling `../<dir>`, matching `dx wt add`'s convention.
create_worktree() {
  local branch="$1" base="$2" wt_path dir_name add_args=()
  dir_name="$(wt_dirname "$branch")"
  [[ -z "$dir_name" ]] && return 1

  if [[ -n "$base" ]]; then
    add_args=(-b "$branch" "$base")
  elif [[ "$(git -C "$repo_root" branch --show-current 2>/dev/null)" == "$branch" ]]; then
    # The main checkout holds this branch, so git will not check it out twice.
    # Detach at the same commit and name the dir after the repo too, since a
    # bare `main`/`master` sibling says nothing about which repo it belongs to.
    add_args=(--detach "$branch")
    dir_name="$(wt_dirname "$(basename "$repo_root")-$branch")"
    [[ -z "$dir_name" ]] && return 1
  else
    add_args=("$branch")
  fi
  wt_path="$(dirname "$repo_root")/$dir_name"

  if [[ -d "$wt_path" ]]; then
    echo "==> Reusing existing directory $wt_path" >&2
  else
    echo "==> git worktree add $wt_path ${add_args[*]}" >&2
    git -C "$repo_root" worktree add "$wt_path" "${add_args[@]}" >/dev/tty 2>&1 || return 1
    setup_worktree "$wt_path"
  fi

  [[ -d "$wt_path" ]] || return 1
  printf '%s\n' "$wt_path"
}

# Run the repo's standard worktree bootstrap in $1, fast steps only (files +
# mise); pnpm install/build are slow, so leave those to the space itself.
# Fresh worktrees are untrusted, so mise.toml needs trusting before `mise x`.
setup_worktree() {
  local wt_path="$1"
  [[ -f "$wt_path/scripts/setup-worktree.mts" ]] || return 0
  command -v mise >/dev/null 2>&1 || return 0
  echo "==> Setting up worktree (files + mise)..." >&2
  ( cd "$wt_path" || exit 0
    mise trust "$wt_path/mise.toml" >/dev/tty 2>&1
    mise x -- pnpm run setup-worktree --only files,mise >/dev/tty 2>&1
  ) || echo "worktree setup had errors - continuing" >&2
}

# ---- 1. pick a directory -------------------------------------------------
candidates() {
  command -v zoxide >/dev/null 2>&1 && zoxide query -l 2>/dev/null
  [[ -d "$HOME/git" ]] && fd -H -t d -d 2 '^\.git$' "$HOME/git" -x dirname 2>/dev/null
}
if [[ -n "${1:-}" && -d "$1" ]]; then
  dir="$1"
else
  dir="$(candidates | awk 'NF && !seen[$0]++' \
    | fzf --prompt='space dir> ' --height=100% --reverse \
          --preview 'ls -la {} 2>/dev/null' --preview-window=right,50% || true)"
  dir="${dir/#\~/$HOME}"
fi
[[ -z "$dir" || ! -d "$dir" ]] && bail "No directory chosen"
cd "$dir" || bail

# ---- 2. open the repo, or a worktree of it? ------------------------------
target_pane="$self"      # default: reuse this pane for claude
target_dir="$dir"

if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  repo_root="$(git -C "$dir" rev-parse --show-toplevel)"
  # Worktree actions belong to the repo as a whole, so run them from the main
  # checkout even when the picked dir is itself a linked worktree.
  main_root="$(dirname "$(git -C "$repo_root" rev-parse --git-common-dir)")"
  [[ -d "$main_root" ]] && repo_root="$(cd "$main_root" && pwd)"
  repo="$(basename "$repo_root")"

  # Existing worktrees of this repo, excluding the main checkout.
  other_worktrees() {
    git -C "$repo_root" worktree list --porcelain 2>/dev/null \
      | awk '/^worktree /{print substr($0, 10)}' | awk -v main="$repo_root" '$0 != main'
  }

  actions=("open $repo" "+ worktree on a new branch" "+ worktree on an existing branch")
  [[ -n "$(other_worktrees)" ]] && actions+=("> open an existing worktree")
  choice="$(printf '%s\n' "${actions[@]}" \
    | fzf --prompt='action> ' --height=40% --reverse --header="Enter to confirm, Esc to just open" || echo "open $repo")"

  case "$choice" in
    "+ worktree on a new branch")
      branch="$(: | fzf --prompt="new branch> " --print-query --height=30% --reverse --header="Type a branch name, Enter to confirm" | head -n1)"
      [[ -z "$branch" ]] && bail "No branch name"

      default_branch="$(git -C "$repo_root" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
      base="$({ echo "HEAD"; [[ -n "$default_branch" ]] && echo "$default_branch"; \
                git -C "$repo_root" for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null; } \
              | awk 'NF && !seen[$0]++' \
              | fzf --prompt="base ref> " --height=60% --reverse --header="Branch '$branch' off which ref?" || true)"
      [[ -z "$base" ]] && bail "No base ref"

      wt_path="$(create_worktree "$branch" "$base")" || bail "Could not create worktree for '$branch'"
      open_space "$wt_path" "$(basename "$wt_path")"
      ;;

    "+ worktree on an existing branch")
      # Local branches first, then remote-tracking ones that have no local
      # counterpart yet; picking one of those branches it locally off the remote.
      branch="$({ git -C "$repo_root" for-each-ref --format='%(refname:short)' --sort=-committerdate refs/heads 2>/dev/null; \
                  git -C "$repo_root" for-each-ref --format='%(refname:short)' --sort=-committerdate refs/remotes 2>/dev/null \
                    | grep -v '/HEAD$'; } \
                | awk 'NF && !seen[$0]++' \
                | fzf --prompt="branch> " --height=80% --reverse --header="Worktree on which existing branch?" \
                      --preview "git -C '$repo_root' log --oneline -20 {}" --preview-window=right,55% || true)"
      [[ -z "$branch" ]] && bail "No branch chosen"

      # A remote-tracking pick becomes a local branch of the same name minus the
      # remote prefix, branched off the remote ref. Local branches keep their
      # name as-is, even when it happens to contain a slash.
      base=""
      if ! git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch" \
         && git -C "$repo_root" show-ref --verify --quiet "refs/remotes/$branch"; then
        for remote in $(git -C "$repo_root" remote); do
          if [[ "$branch" == "$remote/"* ]]; then
            base="$branch"
            branch="${branch#"$remote/"}"
            break
          fi
        done
      fi

      # Already checked out in a linked worktree? Reuse it. The main checkout
      # never counts: this action asked for a worktree, so holding the branch
      # there means detaching a new one instead of handing back the main clone.
      existing="$(git -C "$repo_root" worktree list --porcelain 2>/dev/null \
        | awk -v b="refs/heads/$branch" -v main="$repo_root" \
            '/^worktree /{p=substr($0,10)} $0=="branch "b && p!=main{print p}' | head -n1)"
      if [[ -n "$existing" && -d "$existing" ]]; then
        echo "==> '$branch' is already checked out at $existing"
        open_space "$existing" "$(basename "$existing")"
      fi

      wt_path="$(create_worktree "$branch" "$base")" || bail "Could not create worktree for '$branch'"
      open_space "$wt_path" "$(basename "$wt_path")"
      ;;

    "> open an existing worktree")
      wt_path="$(other_worktrees \
        | fzf --prompt="worktree> " --height=80% --reverse --header="Open which worktree of $repo?" \
              --preview "git -C {} status -sb 2>/dev/null" --preview-window=right,55% || true)"
      [[ -z "$wt_path" || ! -d "$wt_path" ]] && bail "No worktree chosen"
      open_space "$wt_path" "$(basename "$wt_path")"
      ;;
  esac
fi

# ---- 3. plain open: reuse this pane for claude ---------------------------
label="$(basename "$target_dir")"
[[ -n "$self_ws" ]] && "$herdr" workspace rename "$self_ws" "$label" >/dev/null 2>&1 || true
[[ -n "$target_pane" ]] && build_layout "$target_pane" "$target_dir"
exec claude
