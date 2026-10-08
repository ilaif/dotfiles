#!/usr/bin/env python3
"""Worktree cleanup: list the linked worktrees of every open repo, preselect the removable ones, remove the selection.

Removable = clean tree, merged (a merged PR at this HEAD, or HEAD already in the default branch), no busy agent,
not the invoking space. A space open on a worktree that is only an ancestor of the default branch (no merged PR)
stays unselected: it is usually a fresh worktree about to be worked on.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from spaces import BOLD, DIM, GREEN, HERDR, RESET, STATE_DIR, YELLOW, cli, workspaces

RED = "\033[31m"
CACHE = os.path.join(STATE_DIR, "cleanup.json")
BUSY = {"working", "blocked"}


def git(cwd, *args):
    return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)


def repo_context(repo):
    default = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").stdout.strip()
    git(repo, "fetch", "--quiet", "origin", default.split("/", 1)[1])
    prs = subprocess.run(["gh", "pr", "list", "--state", "merged", "--author", "@me", "--limit", "500",
                          "--json", "headRefName,headRefOid"], cwd=repo, capture_output=True, text=True).stdout
    return default, {(p["headRefName"], p["headRefOid"]) for p in json.loads(prs or "[]")}


def classify(wt, repo, default, prs, spaces, current_ws):
    path, branch = wt["path"], wt.get("branch", "")
    ws = spaces.get(wt.get("open_workspace_id"))
    row = {"path": path, "repo": repo, "branch": branch or "detached", "workspace_id": ws and ws["workspace_id"],
           "merged": False, "dirty": False}
    if wt["is_prunable"]:
        return {**row, "reason": "missing dir", "selected": True}
    head = git(path, "rev-parse", "HEAD").stdout.strip()
    row["dirty"] = bool(git(path, "status", "--porcelain").stdout)
    via_pr = (branch, head) in prs
    via_main = git(path, "merge-base", "--is-ancestor", head, default).returncode == 0
    row["merged"] = via_pr or via_main
    if ws and ws["workspace_id"] == current_ws:
        reason = "current space"
    elif ws and ws["agent_status"] in BUSY:
        reason = f"agent {ws['agent_status']}"
    elif row["dirty"]:
        reason = "dirty"
    elif not row["merged"]:
        reason = "unmerged"
    elif ws and not via_pr:
        reason = f"open, in {default}, no PR"
    else:
        return {**row, "reason": "merged PR" if via_pr else f"in {default}", "selected": True}
    return {**row, "reason": reason, "selected": False}


def scan(current_ws):
    spaces = {ws["workspace_id"]: ws for ws in workspaces()}
    repos = sorted({ws["worktree"]["repo_root"] for ws in spaces.values() if ws.get("worktree")})
    with ThreadPoolExecutor() as pool:
        contexts = dict(zip(repos, pool.map(repo_context, repos)))
        jobs = []
        for repo in repos:
            for wt in cli("worktree", "list", "--cwd", repo)["worktrees"]:
                if wt["is_linked_worktree"]:
                    jobs.append(pool.submit(classify, wt, repo, *contexts[repo], spaces, current_ws))
        rows = [job.result() for job in jobs]
    save(sorted(rows, key=lambda r: (not r["selected"], r["path"])))


def load():
    with open(CACHE) as f:
        return json.load(f)


def save(rows):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(rows, f, indent=2)


def risky(r):
    return r["reason"] != "missing dir" and (r["dirty"] or not r["merged"])


def list_rows():
    rows = load()
    width = max([len(os.path.basename(r["path"])) for r in rows] + [10])
    for r in rows:
        box = f"{GREEN}[x]{RESET}" if r["selected"] else f"{DIM}[ ]{RESET}"
        space = "●" if r["workspace_id"] else " "
        color = YELLOW if risky(r) else DIM
        print(f"{r['path']}\t{box} {space} {BOLD}{os.path.basename(r['path']):<{width}}{RESET}  "
              f"{color}{r['reason']:<22}{RESET} {DIM}{r['branch']}{RESET}")


def toggle(path):
    save([{**r, "selected": not r["selected"]} if r["path"] == path else r for r in load()])


def select_all(value):
    save([{**r, "selected": value} for r in load()])


def header():
    rows = load()
    picked = [r for r in rows if r["selected"]]
    n_risky = sum(1 for r in picked if risky(r))
    warn = f"  {YELLOW}{n_risky} unmerged/dirty{RESET}" if n_risky else ""
    print(f"space toggle · ctrl-a all · ctrl-d none · enter remove · esc cancel\n"
          f"{len(picked)}/{len(rows)} selected · ● open space{warn}")


def remove(r):
    force = ["--force"] if r["dirty"] else []
    if r["workspace_id"]:
        out = subprocess.run([HERDR, "worktree", "remove", "--workspace", r["workspace_id"], *force], capture_output=True, text=True)
    else:
        out = git(r["repo"], "worktree", "remove", *force, r["path"])
    return r, (out.stderr or out.stdout).strip() if out.returncode else ""


def apply():
    picked = [r for r in load() if r["selected"]]
    missing = [r for r in picked if r["reason"] == "missing dir"]
    removed = []
    with ThreadPoolExecutor(5) as pool:
        for job in as_completed(pool.submit(remove, r) for r in picked if r not in missing):
            r, error = job.result()
            print(f"{RED}✗{RESET} {os.path.basename(r['path'])}: {error}" if error else f"{GREEN}✓{RESET} {os.path.basename(r['path'])}", flush=True)
            if not error:
                removed.append(r)
    for repo in sorted({r["repo"] for r in missing}):
        git(repo, "worktree", "prune")
        print(f"{GREEN}✓{RESET} pruned missing worktrees of {repo}")
    for repo in sorted({r["repo"] for r in removed}):
        branches = [r["branch"] for r in removed if r["repo"] == repo and r["merged"] and r["branch"] != "detached"]
        if branches:
            git(repo, "branch", "-D", *branches)
            print(f"{DIM}deleted {len(branches)} merged branches in {repo}{RESET}")
    print(f"\n{len(removed) + len(missing)}/{len(picked)} removed")


def main():
    cmd, *args = sys.argv[1:]
    {"scan": lambda: scan(os.environ.get("CLEANUP_WS", "")), "list": list_rows, "toggle": lambda: toggle(args[0]),
     "all": lambda: select_all(True), "none": lambda: select_all(False), "header": header, "apply": apply}[cmd]()


if __name__ == "__main__":
    main()
