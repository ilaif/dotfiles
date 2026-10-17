import { execFileSync } from "node:child_process";

export type Machine = { label: string; target: string; enabled: boolean };

export function run(cmd: string, argv: string[]): string {
  return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function tryRun(cmd: string, argv: string[]): string | undefined {
  try {
    return run(cmd, argv);
  } catch {
    return undefined;
  }
}

export function shellQuote(s: string) {
  return `'${s.replaceAll("'", `'"'"'`)}'`;
}

// Preflight reports every missing prerequisite at once, so one rerun fixes them all.
export const problems: string[] = [];

export function failIfProblems(script: string) {
  if (!problems.length) return;
  console.error(`${script} preflight failed:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(1);
}

export function checkHerdr() {
  if (process.env.HERDR_ENV !== "1") problems.push("not inside Herdr (HERDR_ENV is not 1): run from a Herdr pane");
  if (!tryRun("which", ["herdr"])) problems.push("herdr CLI not on PATH");
}

export function resolveMachine(where: string): Machine | undefined {
  const machines: Machine[] = JSON.parse(run("herdr", ["machine", "list", "--json"]));
  const matches = machines.filter(
    (m) => m.label === where || m.label.split("/").pop() === where || m.target.split(".").pop() === where,
  );
  if (matches.length === 0) {
    const saved = machines.map((m) => m.label).join(", ") || "none";
    problems.push(`no saved Herdr machine matches "${where}" (saved: ${saved}); save it (see ~/.claude/CLAUDE.local.md), then rerun`);
    return;
  }
  if (matches.length > 1) {
    problems.push(`"${where}" matches several machines (${matches.map((m) => m.label).join(", ")}); ask which, then rerun with its full label`);
    return;
  }
  const [machine] = matches;
  if (!machine.enabled) problems.push(`machine ${machine.label} is disabled: run \`herdr machine enable ${machine.label}\``);
  const [status] = JSON.parse(run("herdr", ["machine", "status", machine.label, "--json"]));
  if (status.status !== "reachable") {
    problems.push(
      `machine ${machine.label} is ${status.status}${status.error ? ` (${status.error})` : ""}: the user must run \`! herdr machine reconnect ${machine.label}\``,
    );
  }
  return machine;
}

export function on(machine: Machine | undefined) {
  const machineFlag = machine ? ["--machine", machine.label] : [];
  const herdr = (...argv: string[]) => {
    const out = run("herdr", [...machineFlag, ...argv]);
    return out && JSON.parse(out).result;
  };
  const sh = (cmd: string, ...argv: string[]) =>
    machine ? run("ssh", [machine.target, [cmd, ...argv].map(shellQuote).join(" ")]) : run(cmd, argv);
  const trySh = (cmd: string, ...argv: string[]) => {
    try {
      return sh(cmd, ...argv);
    } catch {
      return undefined;
    }
  };
  return { herdr, sh, trySh };
}
