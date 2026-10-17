// Protects the public URL: one live run at a time and a daily cap, tracked inside the golden VM
// (serverless instances share nothing else). The lock goes stale after 3 minutes without a step.
import type { Sandbox } from "@nodeops-createos/sandbox";
import { safeRunId } from "./sandbox";

export const DAILY_LIVE_RUNS = 60;
export const DAILY_CHECKS = 600; // try-to-fool and model-off conversions: no model cost, but each one runs in the VM
const STALE_SECONDS = 330; // longer than one step's 300 s function limit

export async function acquireRun(sb: Sandbox, runId: string): Promise<{ ok: true } | { ok: false; reason: "busy" | "cap" }> {
  const id = safeRunId(runId);
  const script = [
    "cd /work",
    `day=$(date -u +%Y%m%d); n=$(cat runs-$day 2>/dev/null || echo 0)`,
    `if [ "$n" -ge ${DAILY_LIVE_RUNS} ]; then echo CAP; exit 0; fi`,
    `if [ -f LOCK ] && [ $(( $(date +%s) - $(stat -c %Y LOCK) )) -lt ${STALE_SECONDS} ]; then echo BUSY; exit 0; fi`,
    `echo ${id} > LOCK; echo $((n+1)) > runs-$day; echo OK`,
  ].join("\n");
  const r = await sb.runCommand("flock", ["/work/.guard", "sh", "-c", script], { timeoutMs: 30_000 });
  const out = r.result.stdout.trim();
  if (out.endsWith("OK")) return { ok: true };
  return { ok: false, reason: out.endsWith("CAP") ? "cap" : "busy" };
}

/**
 * Claims attempt `n` of a run and keeps its lock fresh. Each attempt number can be claimed once (an atomic mkdir),
 * so a signed run log can't be replayed to buy more model calls, and only the run holding LOCK can step.
 */
export async function claimStep(sb: Sandbox, runId: string, n: number): Promise<boolean> {
  const id = safeRunId(runId);
  if (!Number.isInteger(n) || n < 1 || n > 99) return false;
  const script = `cd /work && [ "$(cat LOCK 2>/dev/null)" = "${id}" ] && mkdir ${id}.step${n} 2>/dev/null && echo ${id} > LOCK && echo OK || echo BUSY`;
  const r = await sb.runCommand("flock", ["/work/.guard", "sh", "-c", script], { timeoutMs: 30_000 });
  return r.result.stdout.trim().endsWith("OK");
}

export async function releaseRun(sb: Sandbox, runId: string): Promise<void> {
  const id = safeRunId(runId);
  await sb.sh(`cd /work && if [ "$(cat LOCK 2>/dev/null)" = "${id}" ]; then rm -f LOCK; fi; echo done`, { label: "release run lock" });
}

/** True when another live run holds a fresh lock (a cheap pre-check; acquireRun still decides). */
export async function lockBusy(sb: Sandbox): Promise<boolean> {
  const r = await sb.sh(`cd /work && [ -f LOCK ] && [ $(( $(date +%s) - $(stat -c %Y LOCK) )) -lt ${STALE_SECONDS} ] && echo BUSY || echo FREE`, {
    label: "lock check",
  });
  return r.result.stdout.trim().endsWith("BUSY");
}

/** Counts one try-to-fool or model-off check against the daily cap; false when the cap is reached. */
export async function countCheck(sb: Sandbox): Promise<boolean> {
  const script = `cd /work && day=$(date -u +%Y%m%d); n=$(cat checks-$day 2>/dev/null || echo 0); if [ "$n" -ge ${DAILY_CHECKS} ]; then echo CAP; else echo $((n+1)) > checks-$day; echo OK; fi`;
  const r = await sb.runCommand("flock", ["/work/.guard", "sh", "-c", script], { timeoutMs: 30_000 });
  return r.result.stdout.trim().endsWith("OK");
}
