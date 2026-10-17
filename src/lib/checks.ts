// The three release checks outside the agent loop: "Try to fool the gates" (a planted bug in the certified XML)
// and the model-off converter (the certified map.py on a second invoice, no model call).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { countRules } from "./agent";
import { provenance, reconcile, type ReconRow } from "./gates";
import { prepareRun, readOutput, runMap, safeRunId, validateRun } from "./sandbox";
import type { Source, SourceKind } from "./sources";
import type { Outcome, RuleCount, RunLog } from "./runlog";

export type Mutation = "cents" | "discount" | "buyer_id";
export const MUTATIONS: Record<Mutation, string> = {
  cents: "Treat cents as euros",
  discount: "Drop the discount",
  buyer_id: "Invent a buyer Peppol ID",
};
export const isMutation = (x: unknown): x is Mutation => typeof x === "string" && x in MUTATIONS;

export type CheckResult = {
  ms: number;
  xml: string | null;
  rules: { failed: RuleCount[]; warnings: RuleCount[]; error?: string };
  reconciliation: { ties: boolean; rows: ReconRow[] } | null;
  provenance: { total: number; traced: number; untraced: { field: string; value: string }[] } | null;
  outcome: Outcome;
  error?: string;
};

/** The recorded run for a source kind: its certified map.py and XML. */
export function recorded(kind: SourceKind): { runId: string; code: string; xml: string } | null {
  try {
    const run = JSON.parse(readFileSync(path.join(process.cwd(), "public", "replay", `${kind}.json`), "utf8")) as RunLog;
    const a = [...run.attempts].reverse().find((x) => x.outcome === "certified" && x.xml);
    return a?.xml ? { runId: run.runId, code: a.code, xml: a.xml } : null;
  } catch {
    return null;
  }
}

/** Official rules on /work/<runId>/out.xml, then the two model-free gates. */
async function judge(sb: Sandbox, runId: string, source: Source, t0: number): Promise<CheckResult> {
  const v = await validateRun(sb, runId);
  const rules = { failed: countRules(v.failed), warnings: countRules(v.warnings), error: v.wellFormed ? undefined : v.error };
  const xml = await readOutput(sb, runId);
  if (!v.wellFormed || !xml) return { ms: Date.now() - t0, xml, rules, reconciliation: null, provenance: null, outcome: "no_xml", error: v.error };
  const rec = reconcile(xml, source.contract);
  const prov = provenance(xml, source);
  const outcome: Outcome = rules.failed.length ? "rules_failed" : !rec.ties ? "held_reconciliation" : prov.untraced.length ? "held_provenance" : "certified";
  return { ms: Date.now() - t0, xml, rules, reconciliation: { ties: rec.ties, rows: rec.rows }, provenance: prov, outcome };
}

const foolScript = () => readFileSync(path.join(process.cwd(), "vm", "fool.py"), "utf8");

/** Plants one converter bug in the certified XML (in the VM, as nobody) and runs all three checks again. */
export async function fool(sb: Sandbox, runId: string, source: Source, certifiedXml: string, mutation: Mutation): Promise<CheckResult> {
  const t0 = Date.now();
  await prepareRun(sb, runId, { "fool.py": foolScript(), "in.xml": certifiedXml });
  const r = await sb.runCommand(
    "sh",
    ["-c", `cd /work/${safeRunId(runId)} && timeout 20 runuser -u nobody -- /usr/bin/python3 fool.py ${mutation} in.xml out.xml`],
    { timeoutMs: 40_000 },
  );
  if (r.result.exit_code !== 0) {
    const why = (r.result.stderr || r.result.stdout).trim().split("\n").slice(-1)[0];
    return { ms: Date.now() - t0, xml: null, rules: { failed: [], warnings: [] }, reconciliation: null, provenance: null, outcome: "error", error: why };
  }
  return judge(sb, runId, source, t0);
}

/** Runs a certified map.py on another invoice of the same kind. No model call. */
export async function convert(sb: Sandbox, runId: string, source: Source, code: string): Promise<CheckResult> {
  const t0 = Date.now();
  await prepareRun(sb, runId, { [source.fileName]: source.raw, "partners.json": JSON.stringify(source.partners, null, 2), "map.py": code });
  const run = await runMap(sb, runId);
  if (run.exitCode !== 0) {
    const why = run.stderr.trim().split("\n").slice(-1)[0];
    return { ms: Date.now() - t0, xml: null, rules: { failed: [], warnings: [] }, reconciliation: null, provenance: null, outcome: "no_xml", error: why };
  }
  return judge(sb, runId, source, t0);
}
