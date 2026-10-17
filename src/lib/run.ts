// Run lifecycle shared by the CLI and the API routes: start on the golden VM, one attempt per step, a verdict.
import { randomBytes } from "node:crypto";
import artefacts from "../../vm/artefacts.json";
import { attempt, isFinal } from "./agent";
import { EGRESS_LOCK, IMAGE, SHAPE, client, ensureGolden, type Log } from "./sandbox";
import { loadSource, type SourceKind } from "./sources";
import type { Attempt, RunLog } from "./runlog";

export function newRunId(): string {
  return `run-${randomBytes(5).toString("hex")}`;
}

const sha = (file: string) => artefacts.artefacts.find((a) => a.file === file)?.sha256 ?? "";
export const RULESETS: RunLog["rulesets"] = [
  { name: "CEN EN16931 (UBL)", version: "validation-1.3.17", file: "EN16931-UBL-validation.xslt", sha256: sha("EN16931-UBL-validation.xslt") },
  { name: "Peppol BIS Billing 3.0", version: "v3.0.20", file: "PEPPOL-EN16931-UBL.sch", sha256: sha("PEPPOL-EN16931-UBL.sch") },
];

export async function startRun(kind: SourceKind, log?: Log): Promise<RunLog> {
  const source = loadSource(kind);
  const { sandbox, resumeMs } = await ensureGolden(log);
  return {
    runId: newRunId(),
    mode: "live",
    recordedAt: new Date().toISOString(),
    source: { kind, label: source.label, provenance: source.provenance, ref: source.ref, fileName: source.fileName, raw: source.raw },
    model: { id: "", fallbackUsed: false, calls: 0, costUsd: 0 },
    sandbox: {
      vmId: sandbox.id,
      image: IMAGE,
      shape: SHAPE,
      network: "off",
      egressRule: EGRESS_LOCK,
      resumeMs,
      forkedFrom: null,
      plan: "Free",
      liveUrl: null,
      blocked: [],
    },
    rulesets: RULESETS,
    attempts: [],
    verdict: "running",
  };
}

export function verdictOf(attempts: Attempt[]): RunLog["verdict"] {
  const last = attempts[attempts.length - 1];
  if (!last) return "running";
  if (last.outcome === "certified") return "certified";
  if (!isFinal(last)) return "running";
  if (last.outcome === "held_reconciliation" || last.outcome === "held_provenance") return "held";
  if (last.outcome === "error") return "error";
  return "no_release";
}

/** Runs one more attempt on the run's VM and returns the updated run log. */
export async function stepRun(runlog: RunLog, log?: Log): Promise<RunLog> {
  if (runlog.verdict !== "running") return runlog;
  const source = loadSource(runlog.source.kind);
  let sandbox = await client().getSandbox(runlog.sandbox.vmId);
  if (sandbox.status !== "running") {
    sandbox = (await ensureGolden(log)).sandbox;
  }
  const a = await attempt(sandbox, runlog.runId, source, runlog.attempts);
  const attempts = [...runlog.attempts, a];
  const blocked = a.run?.networkBlocked ? [...runlog.sandbox.blocked, { host: "outbound", attempt: a.n, by: "map.py" as const }] : runlog.sandbox.blocked;
  const primary = "Qwen/Qwen3-Coder-480B-A35B-Instruct";
  return {
    ...runlog,
    sandbox: { ...runlog.sandbox, blocked },
    attempts,
    model: {
      id: a.model.id !== "none" ? a.model.id : runlog.model.id,
      fallbackUsed: runlog.model.fallbackUsed || (a.model.id !== "none" && !a.model.id.includes(primary)),
      calls: runlog.model.calls + (a.model.id !== "none" ? 1 : 0),
      costUsd: Math.round((runlog.model.costUsd + a.model.costUsd) * 1e6) / 1e6,
    },
    verdict: verdictOf(attempts),
    xml: a.xml ?? runlog.xml,
  };
}
