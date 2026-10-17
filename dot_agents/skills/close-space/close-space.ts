// Usage: node close-space.ts [--machine <where>] [--force] [--dry-run] [<space> ...]
// Exit 1: preflight problems. Exit 2: something would be lost; confirm, then rerun with --force.
import { parseArgs } from "node:util";
import { checkHerdr, failIfProblems, on, problems, resolveMachine, run } from "../new-space/herdr-lib.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    machine: { type: "string" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

type Workspace = {
  workspace_id: string;
  label: string;
  agent_status: string;
  worktree?: { checkout_path: string; is_linked_worktree: boolean; repo_root: string };
};

checkHerdr();
failIfProblems("close-space");

const machine = args.machine ? resolveMachine(args.machine) : undefined;
if (machine && !positionals.length) problems.push("a remote close needs the space name; the current workspace is local");
failIfProblems("close-space");

const { herdr, sh } = on(machine);
const workspaces: Workspace[] = herdr("workspace", "list").workspaces;
const currentId = machine ? undefined : process.env.HERDR_WORKSPACE_ID;

function resolve(name: string): Workspace | undefined {
  const matches = workspaces.filter(
    (w) =>
      w.label === name ||
      w.workspace_id === name ||
      w.worktree?.checkout_path === name ||
      w.worktree?.checkout_path.split("/").pop() === name,
  );
  if (matches.length === 1) return matches[0];
  const candidates = (matches.length ? matches : workspaces).map((w) => `${w.label} (${w.workspace_id})`).join(", ");
  problems.push(`"${name}" matches ${matches.length ? "several" : "no"} workspaces; candidates: ${candidates}`);
}

const targets = (positionals.length ? positionals : [currentId!]).map(resolve);
failIfProblems("close-space");

const spaces = targets.map((w) => {
  const wt = w!.worktree?.is_linked_worktree ? w!.worktree : undefined;
  const branch = wt && sh("git", "-C", wt.checkout_path, "branch", "--show-current");
  return {
    workspace: w!,
    wt,
    branch,
    dirty: wt ? sh("git", "-C", wt.checkout_path, "status", "--porcelain") : "",
    unpushed: branch ? sh("git", "-C", wt!.repo_root, "log", "--oneline", branch, "--not", "--remotes") : "",
  };
});

const agentBusy = (s: (typeof spaces)[number]) =>
  s.workspace.agent_status === "working" && s.workspace.workspace_id !== currentId;
const risky = spaces.filter((s) => s.dirty || s.unpushed || agentBusy(s) || !s.wt);
if (risky.length && !args.force) {
  console.error("close-space needs confirmation:");
  for (const s of risky) {
    console.error(`- ${s.workspace.label} (${s.workspace.workspace_id})`);
    if (!s.wt) console.error("  main checkout or no worktree: only the workspace would close, nothing removed");
    if (agentBusy(s)) console.error("  agent is working");
    if (s.dirty) console.error(`  dirty files:\n${s.dirty.replace(/^/gm, "    ")}`);
    if (s.unpushed) console.error(`  unpushed commits:\n${s.unpushed.replace(/^/gm, "    ")}`);
  }
  console.error("Ask the user; on yes, rerun with --force.");
  process.exit(2);
}

if (args["dry-run"]) {
  for (const s of spaces) console.log(`would close ${s.workspace.label} · ${s.wt?.checkout_path ?? "no worktree"} · ${s.branch ?? "no branch"}`);
  process.exit(0);
}

function ancestry() {
  const pids = new Set<string>();
  for (let pid = String(process.pid); pid !== "1" && pid !== "0"; pid = run("ps", ["-o", "ppid=", "-p", pid]).trim()) {
    pids.add(pid);
  }
  return pids;
}

const skip = machine ? new Set<string>() : ancestry();

function stopProcesses(path: string) {
  const pids = sh("ps", "-axo", "pid=,command=")
    .split("\n")
    .filter((line) => line.includes(path))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((pid) => !skip.has(pid));
  if (pids.length) sh("kill", "-TERM", ...pids);
}

let closeLast: string | undefined;
for (const s of spaces) {
  if (s.wt) {
    stopProcesses(s.wt.checkout_path);
    const main = s.wt.repo_root;
    try {
      sh("git", "-C", main, "worktree", "remove", ...(args.force ? ["--force"] : []), s.wt.checkout_path);
    } catch (err) {
      if (sh("git", "-C", main, "worktree", "list").includes(s.wt.checkout_path)) throw err;
      sh("git", "-C", main, "worktree", "prune");
    }
    if (s.branch) sh("git", "-C", main, "branch", "-D", s.branch);
  }
  console.log(`closed ${s.workspace.label} (${s.workspace.workspace_id}) · removed ${s.wt?.checkout_path ?? "nothing"} · deleted branch ${s.branch ?? "none"}`);
  if (s.workspace.workspace_id === currentId) closeLast = s.workspace.workspace_id;
  else herdr("workspace", "close", s.workspace.workspace_id);
}

if (closeLast) console.log(`CLOSE LAST (ends this session): herdr workspace close ${closeLast}`);

if (machine) {
  const closed = new Set(spaces.map((s) => s.workspace.workspace_id));
  const remaining = workspaces.filter((w) => !closed.has(w.workspace_id) && w.worktree?.is_linked_worktree);
  if (!remaining.length) console.log(`LAST SPACE on ${machine.label}: ask whether to keep, stop, or delete the Podium workspace`);
}
