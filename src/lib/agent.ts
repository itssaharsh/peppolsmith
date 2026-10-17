// The write -> run -> check -> fix loop. One call to attempt() is one iteration: the model writes or fixes map.py,
// the CreateOS VM runs it with the network off, the official rules check out.xml, and the model-free gates decide.
import { createTwoFilesPatch } from "diff";
import { applyEdits, hasEditBlocks } from "./edits";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { SYSTEM_PROMPT, firstPrompt, fixPrompt, isStuck } from "./prompts";
import { prepareRun, readOutput, runMap, validateRun, type RuleFailure } from "./sandbox";
import { reconcile, provenance } from "./gates";
import type { Source } from "./sources";
import type { Attempt, RuleCount, Step } from "./runlog";

export const MAX_ATTEMPTS = 6;
/** Model time per attempt, so a step (model + VM run + rules) stays inside the 300 s function limit. */
const MODEL_BUDGET_MS = 190_000;

type Provider = { id: string; provider: string; url: string; keyEnv: string; inPerM: number; outPerM: number; timeoutMs: number; body?: Record<string, unknown> };

const FEATHERLESS = "https://api.featherless.ai/v1/chat/completions";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
export const PROVIDERS: Provider[] = [
  { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", provider: "Featherless", url: FEATHERLESS, keyEnv: "FEATHERLESS_API_KEY", inPerM: 0.38, outPerM: 1.55, timeoutMs: 120_000 },
  { id: "deepseek-ai/DeepSeek-V3.2", provider: "Featherless", url: FEATHERLESS, keyEnv: "FEATHERLESS_API_KEY", inPerM: 0.264, outPerM: 0.41, timeoutMs: 75_000 },
  {
    id: "openrouter free coding models",
    provider: "OpenRouter (via Stripe Projects)",
    url: OPENROUTER,
    keyEnv: "OPENROUTER_API_API_KEY",
    inPerM: 0,
    outPerM: 0,
    timeoutMs: 60_000,
    body: { models: ["cohere/north-mini-code:free", "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"], reasoning: { effort: "low" } },
  },
];

export type ModelReply = { text: string; modelId: string; provider: string; ms: number; tokensIn: number; tokensOut: number; costUsd: number };

export function extractCode(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => !/<{7} SEARCH|>{7} REPLACE/.test(b));
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim() + "\n";
  if (/^\s*(import |from |#!)/.test(text)) return text.trim() + "\n";
  return null;
}

/** Calls the providers in order until one returns a usable code block. */
export async function writeCode(userPrompt: string, deadline = Date.now() + 200_000): Promise<ModelReply> {
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    const budget = Math.min(p.timeoutMs, deadline - Date.now());
    if (budget < 15_000) {
      errors.push(`${p.provider} ${p.id}: skipped, out of time for this attempt`);
      continue;
    }
    const key = process.env[p.keyEnv];
    if (!key) {
      errors.push(`${p.provider}: no key`);
      continue;
    }
    const t = Date.now();
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Peppolsmith" },
        body: JSON.stringify({
          model: p.body?.models ? undefined : p.id,
          ...p.body,
          max_tokens: 8000,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(budget),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { model?: string; choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = d.choices?.[0]?.message?.content ?? "";
      if (d.choices?.[0]?.finish_reason === "length") throw new Error("the reply hit the token limit");
      if (!extractCode(text) && !hasEditBlocks(text)) throw new Error("no code block or edit block in the reply");
      const tokensIn = d.usage?.prompt_tokens ?? 0;
      const tokensOut = d.usage?.completion_tokens ?? 0;
      return {
        text,
        modelId: d.model ?? p.id,
        provider: p.provider,
        ms: Date.now() - t,
        tokensIn,
        tokensOut,
        costUsd: (tokensIn * p.inPerM + tokensOut * p.outPerM) / 1_000_000,
      };
    } catch (e) {
      errors.push(`${p.provider} ${p.id}: ${(e as Error).message}`);
    }
  }
  throw new Error(`every model provider failed: ${errors.join(" | ")}`);
}

export function countRules(failures: RuleFailure[]): RuleCount[] {
  const by = new Map<string, RuleCount>();
  for (const f of failures) {
    const prev = by.get(f.id);
    if (prev) prev.count++;
    else by.set(f.id, { id: f.id, set: f.set, message: f.message, count: 1, location: f.location || undefined, test: f.test || undefined });
  }
  return [...by.values()];
}

/** One write -> run -> check iteration. `previous` holds this run's earlier attempts. */
export async function attempt(sb: Sandbox, runId: string, source: Source, previous: Attempt[]): Promise<Attempt> {
  const t0 = Date.now();
  const n = previous.length + 1;
  const deadline = t0 + MODEL_BUDGET_MS;
  // build on the latest attempt that actually ran map.py; an attempt that failed before running has no feedback to give
  const last = [...previous].reverse().find((a) => a.run !== null);
  const lastChecked = [...previous].reverse().find((a) => a.rules !== null);
  const steps: Step[] = [];
  const step = (s: Step) => steps.push(s);

  // 1. write (or fix) map.py
  let reply: ModelReply;
  try {
    reply = await writeCode(last ? fixPrompt(source, last, isStuck(previous)) : firstPrompt(source), deadline);
  } catch (e) {
    step({ id: "write", status: "fail", ms: Date.now() - t0, who: "model", note: (e as Error).message });
    return blank(n, t0, steps, "error", (e as Error).message, last?.code ?? "");
  }
  // a fix arrives as SEARCH/REPLACE edits on the previous map.py; a first draft (or a rewrite) as a whole file
  let newCode: string | null = null;
  let editNote = "";
  if (last && hasEditBlocks(reply.text)) {
    const r = applyEdits(last.code, reply.text);
    if (r.applied > 0) newCode = r.code;
    editNote = `${r.applied} edit${r.applied === 1 ? "" : "s"} applied${r.failed.length ? `, ${r.failed.length} did not match` : ""}`;
  }
  if (!newCode || newCode === last?.code) newCode = extractCode(reply.text) ?? newCode;
  if (!newCode && last) {
    // the edits didn't match the file: ask once for the whole program instead
    try {
      const again = await writeCode(fixPrompt(source, last, true), deadline);
      newCode = extractCode(again.text);
      reply = { ...again, ms: reply.ms + again.ms, tokensIn: reply.tokensIn + again.tokensIn, tokensOut: reply.tokensOut + again.tokensOut, costUsd: reply.costUsd + again.costUsd };
      editNote = `${editNote}; edits didn't match, asked for the whole file`;
    } catch {
      /* fall through to the error below */
    }
  }
  if (!newCode) {
    step({ id: "write", status: "fail", ms: reply.ms, who: `${reply.modelId} (${reply.provider})`, note: "no usable code or edits" });
    return blank(n, t0, steps, "error", "The model's reply had no usable code or edits.", last?.code ?? "");
  }
  step({ id: "write", status: "ok", ms: reply.ms, who: `${reply.modelId} (${reply.provider})`, note: editNote || undefined });
  const patch = createTwoFilesPatch("map.py", "map.py", last?.code ?? "", newCode, `attempt ${n - 1}`, `attempt ${n}`, { context: 2 });
  const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const base = {
    n,
    code: newCode,
    diff: patch,
    added,
    removed,
    model: { id: reply.modelId, provider: reply.provider, ms: reply.ms, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, costUsd: reply.costUsd },
  };

  // 2. run it in the VM as nobody, network off
  await prepareRun(sb, runId, { [source.fileName]: source.raw, "partners.json": JSON.stringify(source.partners, null, 2), "map.py": newCode });
  const run = await runMap(sb, runId);
  const runRec = { exitCode: run.exitCode, stderrTail: run.stderr.slice(-1500), networkBlocked: run.networkBlocked };
  step({ id: "run", status: run.exitCode === 0 ? "ok" : "fail", ms: run.ms, who: "CreateOS VM", note: run.networkBlocked ? "network call blocked" : undefined });
  if (run.exitCode !== 0) {
    return { ...base, ms: Date.now() - t0, steps, run: runRec, rules: null, reconciliation: null, provenance: null, outcome: "no_xml", error: run.stderr.trim().split("\n").slice(-1)[0] };
  }

  // 3. official rules (orchestrator only, hash-checked validator)
  const tv = Date.now();
  const v = await validateRun(sb, runId);
  const failed = countRules(v.failed);
  const prevIds = new Set(lastChecked?.rules?.failed.map((f) => f.id) ?? []);
  const nowIds = new Set(failed.map((f) => f.id));
  const rules = {
    failed,
    warnings: countRules(v.warnings),
    fixed: [...prevIds].filter((id) => !nowIds.has(id)),
    new: [...nowIds].filter((id) => !prevIds.has(id)),
    error: v.wellFormed ? undefined : v.error,
  };
  const rulesFailed = failed.length + (v.wellFormed ? 0 : 1);
  step({ id: "rules", status: rulesFailed === 0 ? "ok" : "fail", ms: Date.now() - tv, who: "CEN EN16931 + Peppol BIS 3.0", note: `${rulesFailed} failed` });
  const xml = await readOutput(sb, runId);
  if (rulesFailed > 0 || !xml) {
    return { ...base, ms: Date.now() - t0, steps, run: runRec, rules, reconciliation: null, provenance: null, outcome: v.wellFormed ? "rules_failed" : "no_xml", error: v.error, xml: xml ?? undefined };
  }

  // 4. model-free gates on the host
  const tr = Date.now();
  const rec = reconcile(xml, source.contract);
  step({ id: "reconcile", status: rec.ties ? "ok" : "fail", ms: Date.now() - tr, who: "reconciliation (no model)" });
  const prov = provenance(xml, source);
  step({ id: "provenance", status: prov.untraced.length === 0 ? "ok" : "fail", ms: 0, who: "provenance (no model)" });
  const outcome = !rec.ties ? "held_reconciliation" : prov.untraced.length ? "held_provenance" : "certified";
  return { ...base, ms: Date.now() - t0, steps, run: runRec, rules, reconciliation: { rows: rec.rows }, provenance: prov, outcome, xml };
}

function blank(n: number, t0: number, steps: Step[], outcome: Attempt["outcome"], error: string, code: string): Attempt {
  return {
    n,
    ms: Date.now() - t0,
    code,
    diff: "",
    added: 0,
    removed: 0,
    model: { id: "none", provider: "none", ms: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
    steps,
    run: null,
    rules: null,
    reconciliation: null,
    provenance: null,
    outcome,
    error,
  };
}

export function isFinal(a: Attempt): boolean {
  return a.outcome === "certified" || a.n >= MAX_ATTEMPTS;
}
