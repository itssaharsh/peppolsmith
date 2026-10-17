// One run-log shape serves the recorded replay, a live run and every ?state= preview (UI-SPEC §5.5).
import type { RuleFailure } from "./sandbox";
import type { ReconRow } from "./gates";
import type { SourceKind } from "./sources";

export type StepId = "write" | "run" | "rules" | "reconcile" | "provenance";
export type Step = { id: StepId; status: "ok" | "fail" | "skipped"; ms: number; who: string; note?: string };

export type RuleCount = { id: string; set: string; message: string; count: number; location?: string; test?: string };

export type Outcome = "rules_failed" | "no_xml" | "held_reconciliation" | "held_provenance" | "certified" | "error";

export type Attempt = {
  n: number;
  ms: number;
  code: string; // the full map.py of this attempt
  diff: string; // unified diff against the previous attempt (attempt 1: whole file)
  added: number;
  removed: number;
  model: { id: string; provider: string; ms: number; tokensIn: number; tokensOut: number; costUsd: number };
  steps: Step[];
  run: { exitCode: number; stderrTail: string; networkBlocked: boolean } | null;
  rules: { failed: RuleCount[]; warnings: RuleCount[]; fixed: string[]; new: string[]; error?: string } | null;
  reconciliation: { rows: ReconRow[] } | null;
  provenance: { total: number; traced: number; untraced: { field: string; value: string }[] } | null;
  outcome: Outcome;
  error?: string;
  xml?: string; // out.xml of this attempt, when map.py wrote one
};

export type RunLog = {
  runId: string;
  mode: "live" | "replay" | "preview";
  recordedAt: string;
  source: { kind: SourceKind; label: string; provenance: string; ref: string; fileName?: string; raw?: string; custom?: boolean };
  model: { id: string; fallbackUsed: boolean; calls: number; costUsd: number };
  sandbox: {
    vmId: string;
    image: string;
    shape: string;
    network: "off";
    egressRule: string[];
    resumeMs: number | null;
    forkedFrom: string | null;
    plan: string;
    liveUrl: string | null;
    blocked: { host: string; attempt: number; by: "map.py" | "probe" }[];
  };
  rulesets: { name: string; version: string; file: string; sha256: string }[];
  attempts: Attempt[];
  verdict: "running" | "certified" | "held" | "no_release" | "error";
  xml?: string; // the released XML (certified) or the last XML produced
  sig?: string; // server signature over the attempts (live runs only)
};

export type { RuleFailure };
