// Usage: node new-space.ts --slug <slug> --task <task> [--agent claude] [--machine <label>] [--repo <path>]
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    slug: { type: "string" },
    task: { type: "string" },
    agent: { type: "string", default: "claude" },
    machine: { type: "string" },
    repo: { type: "string" },
  },
});
if (!args.slug || !args.task) throw new Error("--slug and --task are required");
if (process.env.HERDR_ENV !== "1") throw new Error("not inside Herdr (HERDR_ENV unset)");

const machineFlag = args.machine ? ["--machine", args.machine] : [];

function run(cmd: string, argv: string[]): string {
  return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function herdr(...argv: string[]) {
  const out = run("herdr", [...machineFlag, ...argv]);
  return out && JSON.parse(out).result;
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function shellQuote(s: string) {
  return `'${s.replaceAll("'", `'"'"'`)}'`;
}

const target = args.machine
  ? JSON.parse(run("herdr", ["machine", "list", "--json"])).find(
      (m: { label: string }) => m.label === args.machine,
    ).target
  : undefined;

function git(...argv: string[]) {
  return target ? run("ssh", [target, ["git", ...argv].map(shellQuote).join(" ")]) : run("git", argv);
}

const repo =
  args.repo ??
  (target
    ? herdr("workspace", "list").workspaces.find(
        (w: { worktree?: { is_linked_worktree: boolean } }) => w.worktree && !w.worktree.is_linked_worktree,
      ).worktree.checkout_path
    : dirname(run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"])));

git("-C", repo, "fetch", "origin");
const base = git("-C", repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "");

function createWorktree() {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? args.slug! : `${args.slug}-${n}`;
    const path = `${dirname(repo)}/${slug}`;
    try {
      return { slug, path, ...herdr("worktree", "create", "--cwd", repo, "--branch", slug, "--base", base, "--path", path, "--label", slug, "--no-focus") };
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

herdr("pane", "run", rootPane, args.agent!);
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
  `${args.machine ?? "Local"} · workspace ${created.slug} (${workspaceId}) · ${created.path} · branch ${created.slug} · ${args.agent}`,
);
