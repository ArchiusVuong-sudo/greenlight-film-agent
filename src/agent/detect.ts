import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Mode = "live" | "replay";

/**
 * Live when the SDK can authenticate: ANTHROPIC_API_KEY, or a local Claude Code login
 * (the macOS keychain item or the credentials file in the home folder). DEMO_REPLAY=1 forces replay.
 * Only the presence of a login is checked; no secret is read.
 */
export function detectMode(env: Record<string, string | undefined> = process.env): { mode: Mode; reason: string } {
  if (env.DEMO_REPLAY === "1") return { mode: "replay", reason: "DEMO_REPLAY=1" };
  if (env.ANTHROPIC_API_KEY) return { mode: "live", reason: "ANTHROPIC_API_KEY is set" };
  if (existsSync(join(homedir(), ".claude", ".credentials.json"))) return { mode: "live", reason: "Claude Code login found" };
  if (process.platform === "darwin") {
    const r = spawnSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], { stdio: "ignore" });
    if (r.status === 0) return { mode: "live", reason: "Claude Code login found" };
  }
  return { mode: "replay", reason: "No Claude Code login or ANTHROPIC_API_KEY found" };
}

const ENV_ALLOW = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "ANTHROPIC_API_KEY"];

/** The child process gets only these variables (CLAUDECODE and CLAUDE_CODE_* never pass). */
export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = env[k];
    if (v) out[k] = v;
  }
  return out;
}
