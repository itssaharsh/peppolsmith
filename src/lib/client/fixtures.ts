// ?state= previews, built from the loaded recorded run. Every view built here is labelled "State preview".
import type { Attempt, RuleCount, RunLog } from "@/lib/runlog";
import type { ReconRow } from "@/lib/gates";

export const PREVIEW_STATES = [
  "idle",
  "running",
  "passed",
  "held",
  "held-provenance",
  "blocked",
  "no-release",
  "busy",
  "error",
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];
export const isPreview = (s: unknown): s is PreviewState => PREVIEW_STATES.includes(s as PreviewState);

const SAMPLE_RULES: RuleCount[] = [
  {
    id: "BR-CO-15",
    set: "CEN EN16931",
    message: "Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).",
    count: 1,
  },
  {
    id: "PEPPOL-EN16931-R010",
    set: "Peppol BIS Billing 3.0",
    message: "Buyer electronic address MUST be provided",
    count: 1,
  },
  {
    id: "BR-S-08",
    set: "CEN EN16931",
    message:
      "For each different value of VAT category rate (BT-119) where the VAT category code (BT-118) is \"Standard rated\", the VAT category taxable amount (BT-116) in a VAT breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) plus the sum of document level charge amounts (BT-99) minus the sum of document level allowance amounts (BT-92) where the VAT category code (BT-151, BT-102, BT-95) is \"Standard rated\" and the VAT rate (BT-152, BT-103, BT-96) equals the VAT category rate (BT-119).",
    count: 1,
  },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function baseAttempt(run: RunLog): Attempt {
  const last = run.attempts[run.attempts.length - 1];
  return clone(last);
}

/** A held-on-totals copy of the certified attempt: the XML drops a 10% document discount. */
function heldRows(rows: ReconRow[]): ReconRow[] {
  const out = clone(rows);
  const net = out.find((r) => /net total/i.test(r.check));
  const due = out.find((r) => /amount due/i.test(r.check));
  const vats = out.filter((r) => /^VAT /i.test(r.check));
  if (!net || !due || net.source === null) return out;
  const grossNet = Math.round(net.source / 0.9);
  const delta = grossNet - net.source;
  net.xml = grossNet;
  net.ties = false;
  let vatDelta = 0;
  if (vats[0] && vats[0].source !== null) {
    const rate = Number(vats[0].check.replace(/[^0-9.]/g, "")) || 21;
    vatDelta = Math.round((delta * rate) / 100);
    vats[0].xml = vats[0].source + vatDelta;
    vats[0].ties = false;
  }
  if (due.source !== null) {
    due.xml = due.source + delta + vatDelta;
    due.ties = false;
  }
  return out;
}

export type Preview = {
  run: RunLog | null;
  selected: number | null;
  busy?: boolean;
  validatorDown?: boolean;
  runningSince?: number; // ms ago when the in-flight attempt started
};

export function buildPreview(state: PreviewState, replay: RunLog | null, others: (RunLog | null)[]): Preview {
  if (state === "idle" || !replay) return { run: null, selected: null };
  const run: RunLog = { ...clone(replay), mode: "preview" };
  const last = run.attempts.length - 1;
  switch (state) {
    case "passed":
    case "busy":
    case "error":
      return {
        run,
        selected: last,
        busy: state === "busy",
        validatorDown: state === "error",
      };
    case "running": {
      const done = run.attempts.slice(0, Math.max(0, run.attempts.length - 1));
      return { run: { ...run, attempts: done, verdict: "running" }, selected: done.length ? done.length - 1 : null, runningSince: 18000 };
    }
    case "held": {
      const a = baseAttempt(run);
      if (a.reconciliation) a.reconciliation.rows = heldRows(a.reconciliation.rows);
      a.outcome = "held_reconciliation";
      if (a.rules) a.rules = { ...a.rules, failed: [], fixed: [], new: [] };
      a.steps = a.steps.map((s) => (s.id === "reconcile" ? { ...s, status: "fail" as const } : s));
      return { run: { ...run, attempts: [{ ...a, n: 1 }], verdict: "held" }, selected: 0 };
    }
    case "held-provenance": {
      const a = baseAttempt(run);
      const total = a.provenance?.total ?? 9;
      a.provenance = { total, traced: total - 1, untraced: [{ field: "Buyer Peppol ID", value: "0208:0999999999" }] };
      a.outcome = "held_provenance";
      a.steps = a.steps.map((s) => (s.id === "provenance" ? { ...s, status: "fail" as const } : s));
      return { run: { ...run, attempts: [{ ...a, n: 1 }], verdict: "held" }, selected: 0 };
    }
    case "blocked": {
      const a = baseAttempt(run);
      const blocked: Attempt = {
        ...clone(a),
        n: 1,
        outcome: "no_xml",
        xml: undefined,
        rules: null,
        reconciliation: null,
        provenance: null,
        run: { exitCode: 1, stderrTail: "urllib.error.URLError: <urlopen error [Errno 111] Connection refused>", networkBlocked: true },
        steps: a.steps.filter((s) => s.id === "write" || s.id === "run").map((s) => (s.id === "run" ? { ...s, status: "fail" as const } : s)),
        error: "map.py tried to reach pypi.org:443 and the sandbox refused the connection.",
      };
      const fixed: Attempt = { ...clone(a), n: 2 };
      return {
        run: {
          ...run,
          attempts: [blocked, fixed],
          sandbox: { ...run.sandbox, blocked: [{ host: "pypi.org:443", attempt: 1, by: "map.py" }] },
        },
        selected: 0,
      };
    }
    case "no-release": {
      const real = [replay, ...others].find((r) => r && r.verdict === "no_release");
      if (real) return { run: { ...clone(real), mode: "preview" }, selected: real.attempts.length - 1 };
      const a = baseAttempt(run);
      const counts = [3, 3, 2, 2, 2, 1, 1, 1];
      const attempts: Attempt[] = counts.map((c, i) => ({
        ...clone(a),
        n: i + 1,
        outcome: "rules_failed",
        xml: undefined,
        reconciliation: null,
        provenance: null,
        rules: {
          failed: SAMPLE_RULES.slice(0, c),
          warnings: [],
          fixed: i > 0 && counts[i - 1] > c ? SAMPLE_RULES.slice(c, counts[i - 1]).map((r) => r.id) : [],
          new: i === 0 ? SAMPLE_RULES.slice(0, c).map((r) => r.id) : [],
        },
        steps: a.steps.filter((s) => s.id !== "reconcile" && s.id !== "provenance").map((s) => (s.id === "rules" ? { ...s, status: "fail" as const, note: `${c} failed` } : s)),
      }));
      return { run: { ...run, attempts, verdict: "no_release" }, selected: 5 };
    }
  }
}
