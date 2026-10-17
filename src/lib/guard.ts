// Protects the public URL: one live run at a time and a daily cap, tracked inside the golden VM
// (serverless instances share nothing else). The lock goes stale after 3 minutes without a step.
import type { Sandbox } from "@nodeops-createos/sandbox";
import { safeRunId } from "./sandbox";

export const DAILY_LIVE_RUNS = 60;
export const DAILY_CHECKS = 600; // try-to-fool and model-off conversions: no model cost, but each one runs in the VM
const STALE_SECONDS = 180;

export async function acquireRun(sb: Sandbox, runId: string): Promise<{ ok: true } | { ok: false; reason: "busy" | "cap" }> {
  const id = safeRunId(runId);
  const script = [
    "set -e; cd /work",
    `day=$(date -u +%Y%m%d); n=$(cat runs-$day 2>/dev/null || echo 0)`,
    `if [ "$n" -ge ${DAILY_LIVE_RUNS} ]; then echo CAP; exit 0; fi`,
    `if [ -f LOCK ] && [ $(( $(date +%s) - $(stat -c %Y LOCK) )) -lt ${STALE_SECONDS} ]; then echo BUSY; exit 0; fi`,
    `echo ${id} > LOCK; echo $((n+1)) > runs-$day; echo OK`,
  ].join("\n");
  const r = await sb.sh(script, { label: "acquire run lock" });
  const out = r.result.stdout.trim();
  if (out.endsWith("OK")) return { ok: true };
  return { ok: false, reason: out.endsWith("CAP") ? "cap" : "busy" };
}

/** Keeps the lock fresh while a run is stepping; refuses if another run holds it. */
export async function touchRun(sb: Sandbox, runId: string): Promise<boolean> {
  const id = safeRunId(runId);
  const r = await sb.sh(`cd /work && if [ "$(cat LOCK 2>/dev/null)" = "${id}" ] || [ ! -f LOCK ]; then echo ${id} > LOCK; echo OK; else echo BUSY; fi`, {
    label: "touch run lock",
  });
  return r.result.stdout.trim().endsWith("OK");
}

export async function releaseRun(sb: Sandbox, runId: string): Promise<void> {
  const id = safeRunId(runId);
  await sb.sh(`cd /work && if [ "$(cat LOCK 2>/dev/null)" = "${id}" ]; then rm -f LOCK; fi; echo done`, { label: "release run lock" });
}

/** Counts one try-to-fool or model-off check against the daily cap; false when the cap is reached. */
export async function countCheck(sb: Sandbox): Promise<boolean> {
  const r = await sb.sh(
    `cd /work && day=$(date -u +%Y%m%d); n=$(cat checks-$day 2>/dev/null || echo 0); if [ "$n" -ge ${DAILY_CHECKS} ]; then echo CAP; else echo $((n+1)) > checks-$day; echo OK; fi`,
    { label: "count check" },
  );
  return r.result.stdout.trim().endsWith("OK");
}
