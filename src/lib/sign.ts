// Live runs travel through the browser between steps. The server signs each run log it returns and only
// continues logs carrying its own signature, so a client can't feed edited code or prompts into the VM or the model.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RunLog } from "./runlog";

function secret(): string {
  const s = process.env.RUN_SIGNING_SECRET ?? process.env.CREATEOS_PROJECT_API_KEY ?? process.env.CREATEOS_API_KEY;
  if (!s) throw new Error("no signing secret configured");
  return `peppolsmith-run-log:${s}`;
}

function digest(run: RunLog): string {
  const body = createHash("sha256").update(JSON.stringify(run.attempts)).digest("hex");
  return createHmac("sha256", secret()).update(`${run.runId}|${run.source.kind}|${run.attempts.length}|${body}`).digest("hex");
}

export function signRun(run: RunLog): RunLog {
  const { sig: _drop, ...rest } = run;
  void _drop;
  return { ...rest, sig: digest(rest as RunLog) };
}

export function verifyRun(run: RunLog): boolean {
  if (typeof run.sig !== "string" || run.sig.length !== 64) return false;
  const want = Buffer.from(digest(run), "hex");
  const got = Buffer.from(run.sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
