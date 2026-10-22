// Usage: node new-space.ts --slug <slug> --task <task> [--agent claude] [--model <name>] [--machine <where>] [--repo <path>]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { checkHerdr, failIfProblems, on, problems, resolveMachine, tryRun } from "./herdr-lib.ts";

const AGENTS = ["claude", "codex", "pi", "opencode", "omp"];

const { values: args } = parseArgs({
  options: {
    slug: { type: "string", default: "" },
    task: { type: "string", default: "" },
    agent: { type: "string", default: "claude" },
    model: { type: "string" },
    machine: { type: "string" },
    repo: { type: "string" },
  },
});

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

if (!args.slug) problems.push("--slug is required");
if (!args.task) problems.push("--task is required");
if (!AGENTS.includes(args.agent)) problems.push(`unknown agent "${args.agent}"; expected one of: ${AGENTS.join(", ")}`);
checkHerdr();
failIfProblems("new-space");

// A short name picks the first Claude modelPicker option whose id or label contains it; anything else passes through.
function resolveModel(name: string): string {
  if (args.agent !== "claude") return name;
  const settings = JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, "utf8")); // no-smell: preserve the existing local parser in this sync; no new runtime dependency.
  const options: { model: string; label: string }[] = settings.modelPicker?.options ?? [];
  const query = name.toLowerCase();
  return options.find((o) => `${o.model} ${o.label}`.toLowerCase().includes(query))?.model ?? name;
}

const model = args.model && resolveModel(args.model);
const agentCommand = model ? `${args.agent} --model ${model}` : args.agent;

const machine = args.machine ? resolveMachine(args.machine) : undefined;
failIfProblems("new-space");

const { herdr, sh, trySh } = on(machine);

function findRepo(): string | undefined {
  if (args.repo) return args.repo;
  if (machine) {
    const repo = herdr("workspace", "list").workspaces.find(
      (w: { worktree?: { is_linked_worktree: boolean } }) => w.worktree && !w.worktree.is_linked_worktree,
    )?.worktree.checkout_path;
    if (!repo) problems.push(`no Herdr workspace on ${machine.label} is a main git checkout; pass --repo <path>`);
    return repo;
  }
  const commonDir = trySh("git", "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!commonDir) problems.push(`${process.cwd()} is not inside a git repo; cd into one or pass --repo <path>`);
  return commonDir && dirname(commonDir);
}

const repo = findRepo();
if (repo) {
  const where = machine ? `${machine.label}:${repo}` : repo;
  if (!trySh("git", "-C", repo, "remote", "get-url", "origin")) problems.push(`${where} has no "origin" remote`);
  else if (!trySh("git", "-C", repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")) {
    problems.push(`${where} has no origin/HEAD: run \`git -C ${repo} remote set-head origin --auto\``);
  }
}
if (!machine && !tryRun("which", [args.agent])) problems.push(`agent CLI "${args.agent}" not on PATH`);
failIfProblems("new-space");

sh("git", "-C", repo!, "fetch", "origin");
const base = sh("git", "-C", repo!, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "");

function createWorktree() {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? args.slug : `${args.slug}-${n}`;
    const path = `${dirname(repo!)}/${slug}`;
    try {
      return { slug, path, ...herdr("worktree", "create", "--cwd", repo!, "--branch", slug, "--base", base, "--path", path, "--label", slug, "--no-focus") };
    } catch (err) {
      if (n === 5) throw err;
    }
  }
}

const created = createWorktree();
const workspaceId: string = created.workspace.workspace_id;
const rootPane: string = created.root_pane.pane_id;

const bottomPane: string = herdr(
  "pane", "split", rootPane, "--direction", "down", "--ratio", "0.9", "--cwd", created.path, "--no-focus",
).pane.pane_id;

herdr("pane", "run", rootPane, agentCommand);
for (let attempt = 1; ; attempt++) {
  try {
    herdr("agent", "wait", rootPane, "--until", "idle", "--timeout", "60000");
    break;
  } catch (err) {
    if (attempt === 30) throw err;
    sleep(2000);
  }
}
herdr("agent", "prompt", rootPane, args.task);

const setup = [
  "[ -f mise.toml ] && mise trust",
  "if [ -x scripts/setup-worktree.sh ]; then ./scripts/setup-worktree.sh </dev/null",
  `elif grep -q '"setup-worktree"' package.json 2>/dev/null; then mise x -- pnpm run setup-worktree --skip install,build </dev/null`,
  "fi",
].join("; ");
herdr("pane", "run", bottomPane, setup);

console.log(
  `${machine?.label ?? "Local"} · workspace ${created.slug} (${workspaceId}) · ${created.path} · branch ${created.slug} · ${agentCommand}`,
);
