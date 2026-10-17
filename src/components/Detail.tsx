"use client";

import { CaretRightIcon, ProhibitIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import type { Attempt, RuleCount, RunLog } from "@/lib/runlog";
import { clock, runModel, secs, STEP_LABEL } from "@/lib/client/format";
import { Tick } from "./glyphs";

const cleanMsg = (m: string) => {
  const t = m.replace(/^\[[^\]]+\]\s*-?\s*/, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

const SHORT_STEP: Record<string, string> = {
  write: "writing code",
  run: "running it",
  rules: "EU rules",
  reconcile: "totals",
  provenance: "IDs",
};

/* ---------------- Running checklist ---------------- */

export function Checklist({ run, stepIndex, elapsedMs }: { run: RunLog | null; stepIndex: number; elapsedMs: number }) {
  const model = runModel(run);
  const vm = run?.sandbox.vmId ?? "";
  const who = [
    `${model.name}, through ${model.provider}`,
    `CreateOS VM ${vm}`.trim(),
    "In the VM, run by Peppolsmith, not by map.py",
    "Server, no model",
    "Server, no model",
  ];
  const ids = Object.keys(STEP_LABEL);
  return (
    <section aria-label="Running steps" className="fade-in">
      <h2 className="text-[15px] font-bold">Try {(run?.attempts.length ?? 0) + 1} is running</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        All five steps report back together when the try finishes, usually within a minute. The highlighted step is an estimate.
      </p>
      <ol className="mt-3">
        {ids.map((id, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex ? "running" : "pending";
          return (
            <li key={id} className="flex min-h-9 items-center gap-3 border-b border-line/60 py-1.5 last:border-0">
              <span aria-hidden className="w-4 text-center text-[14px]">
                {state === "done" ? <Tick size={14} /> : state === "running" ? <span className="text-ink">●</span> : <span className="text-ink-muted">○</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14px] ${state === "running" ? "shimmer" : state === "pending" ? "text-ink-muted" : ""}`}>
                  {STEP_LABEL[id]}
                </span>
                <span className="block truncate text-[12px] text-ink-muted">{who[i]}</span>
              </span>
              <span className="text-[13px] text-ink-muted tnum">{state === "running" ? clock(elapsedMs) : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------- Change pane ---------------- */

type View = "change" | "source" | "xml";

function DiffWell({ diff, full }: { diff: string; full: boolean }) {
  const lines = diff
    .split("\n")
    .filter((l) => !l.startsWith("Index:") && !/^=+$/.test(l) && !l.startsWith("--- ") && !l.startsWith("+++ "));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const shown = full ? lines : lines.slice(0, 16);
  return (
    <div className="well py-3" style={{ maxHeight: full ? 520 : undefined }}>
      <pre>
        {shown.map((l, i) => {
          const add = l.startsWith("+");
          const del = l.startsWith("-");
          const hunk = l.startsWith("@@");
          return (
            <div
              key={i}
              className={`px-4 ${add ? "bg-add text-ink" : del ? "bg-del text-ink" : hunk ? "text-ink-muted" : "text-ink-muted"}`}
            >
              {hunk ? (
                l
              ) : (
                <>
                  <span className={add ? "text-success" : "text-ink-muted"}>{add ? "+" : del ? "−" : " "}</span>
                  {l.slice(1) || " "}
                </>
              )}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function TextWell({ text, full }: { text: string; full: boolean }) {
  const lines = text.split("\n");
  const shown = full ? text : lines.slice(0, 16).join("\n");
  return (
    <div className="well px-4 py-3" style={{ maxHeight: full ? 520 : undefined }}>
      <pre>{shown}</pre>
    </div>
  );
}

export function ChangePane({ run, attempt }: { run: RunLog; attempt: Attempt }) {
  const [view, setView] = useState<View>("change");
  const [full, setFull] = useState(false);
  const prevFailed = run.attempts[attempt.n - 2]?.rules?.failed.length;
  const failed = attempt.rules?.failed.length;
  const writeStep = attempt.steps.find((s) => s.id === "write");

  let summary = "";
  if (attempt.outcome === "error" && !attempt.diff) summary = "The AI sent back no code in this try.";
  else if (attempt.n === 1) summary = `First draft: the AI wrote a ${attempt.added || attempt.code?.split("\n").length || 0}-line Python converter, map.py.`;
  else if (!attempt.diff || (attempt.added === 0 && attempt.removed === 0)) summary = "No code change in this try.";
  else if (attempt.rules)
    summary = `The AI read the errors from the last try and edited ${attempt.added + attempt.removed} lines. Fixed ${attempt.rules.fixed.length}, ${attempt.rules.new.length} new, ${failed ?? 0} left.`;
  else summary = `The AI edited its code: ${attempt.added} lines added, ${attempt.removed} removed.`;
  void prevFailed;

  const diffLines = attempt.diff ? attempt.diff.split("\n").filter((l) => !l.startsWith("Index:") && !/^=+$/.test(l)).length : 0;
  const text = view === "source" ? run.source.raw : view === "xml" ? attempt.xml : undefined;
  const textLines = text ? text.split("\n").length : 0;

  return (
    <section aria-labelledby="change-h" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="change-h" className="text-[15px] font-bold">
          What the AI changed in its code <span className="font-normal text-ink-muted">(try {attempt.n})</span>
        </h2>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-md bg-surface-2 p-0.5">
          {(["change", "source", "xml"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => {
                setView(v);
                setFull(false);
              }}
              className={`h-7 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                view === v ? "bg-surface-1 font-semibold text-ink shadow-[0_0_0_1px_var(--line-input)]" : "text-ink-muted hover:text-ink"
              }`}
            >
              {v === "change" ? "Code change" : v === "source" ? "Original" : "E-invoice"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[14px]">{summary}</p>
      {attempt.run?.networkBlocked ? (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]">
          <ProhibitIcon size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <span>
            The sandbox blocked the code&apos;s attempt to reach the internet. The AI&apos;s code runs with no internet, so it stopped before writing
            the invoice.
          </span>
        </p>
      ) : null}
      {attempt.error ? (
        <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] leading-5 break-words text-ink">
          {attempt.outcome === "error" && writeStep?.note ? writeStep.note : attempt.error}
        </p>
      ) : null}
      <div className="mt-3">
        {view === "change" ? (
          attempt.diff ? (
            <DiffWell diff={attempt.diff} full={full} />
          ) : (
            <p className="rounded-md bg-surface-sunken px-4 py-3 text-[14px] text-ink-muted">No code change in this try.</p>
          )
        ) : text ? (
          <TextWell text={text} full={full} />
        ) : (
          <p className="rounded-md bg-surface-sunken px-4 py-3 text-[14px] text-ink-muted">
            {view === "source" ? "The original invoice isn't in this recording." : "This try produced no e-invoice."}
          </p>
        )}
        {view === "change" && diffLines > 18 ? (
          <button type="button" onClick={() => setFull(!full)} className="link mt-2 text-[14px] font-medium">
            {full ? "Show less" : `Show full change (${diffLines} lines)`}
          </button>
        ) : null}
        {view !== "change" && textLines > 16 ? (
          <button type="button" onClick={() => setFull(!full)} className="link mt-2 text-[14px] font-medium">
            {full ? "Show less" : `Show all ${textLines} lines`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------- Rules list ---------------- */

function RuleRow({ r, fixed }: { r: RuleCount; fixed?: boolean }) {
  const extra = r as RuleCount & { test?: string; location?: string };
  return (
    <li>
      <details className="group">
        <summary className="grid min-h-9 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm py-1 hover:bg-surface-2/60">
          <CaretRightIcon size={12} className="caret text-ink-muted" aria-hidden />
          <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
            {fixed ? <Tick size={13} /> : null}
            <span className="truncate">{r.message ? cleanMsg(r.message) : r.id}</span>
          </span>
          <span className="font-mono text-[11px] text-ink-muted">{r.id}</span>
        </summary>
        <div className="pb-2 pl-6 pr-2 text-[13px] leading-5">
          <p>{cleanMsg(r.message)}</p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Rule <span className="font-mono">{r.id}</span>
            {r.set ? `, ${r.set}` : ""}
            {!fixed && r.count > 1 ? `. Found ${r.count} times.` : "."}
          </p>
          {extra.test ? (
            <div className="mt-1.5">
              <p className="text-[12px] font-semibold text-ink-muted">Official test</p>
              <div className="well mt-0.5 px-2 py-1.5 text-[12px] leading-[18px]">
                <pre className="whitespace-pre-wrap break-all">{extra.test}</pre>
              </div>
            </div>
          ) : null}
          {extra.location ? <p className="mt-1 break-all font-mono text-[12px] text-ink-muted">{extra.location}</p> : null}
        </div>
      </details>
    </li>
  );
}

export function RulesList({ run, attempt, running }: { run: RunLog; attempt: Attempt; running: boolean }) {
  const [all, setAll] = useState(false);
  const rules = attempt.rules;
  const prev = run.attempts[attempt.n - 2];
  const fixedRules: RuleCount[] = (rules?.fixed ?? []).map(
    (id) => prev?.rules?.failed.find((r) => r.id === id) ?? { id, set: "", message: "", count: 0 },
  );
  const failed = rules?.failed ?? [];
  const shown = all ? failed : failed.slice(0, 10);

  return (
    <section aria-labelledby="rules-h" className="min-w-0">
      <h2 id="rules-h" className="text-[15px] font-bold">
        {running ? "Errors the AI is fixing" : "Errors to fix"}{" "}
        <span className="font-normal text-ink-muted tnum">({rules ? failed.length : 0})</span>
      </h2>
      {!rules ? (
        <p className="mt-2 text-[14px] text-ink-muted">
          {attempt.outcome === "no_xml"
            ? "Nothing to check: the code crashed before it produced an invoice."
            : attempt.outcome === "error"
              ? "Nothing to check in this try."
              : "Not checked yet."}
        </p>
      ) : rules.error ? (
        <p className="mt-2 text-[14px]">Couldn&apos;t run the EU checker: {rules.error}</p>
      ) : failed.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-[14px]">
          <Tick size={16} /> No errors: the EU checker found nothing to fix.
        </p>
      ) : (
        <>
          <ul className="mt-2">{shown.map((r) => <RuleRow key={r.id} r={r} />)}</ul>
          {failed.length > 10 ? (
            <button type="button" className="link mt-1 text-[14px] font-medium" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${failed.length}`}
            </button>
          ) : null}
        </>
      )}
      {fixedRules.length ? (
        <details className="mt-3">
          <summary className="flex items-center gap-2 text-[14px] font-semibold">
            <CaretRightIcon size={12} className="caret text-ink-muted" aria-hidden /> Fixed in this try ({fixedRules.length})
          </summary>
          <ul className="mt-1">{fixedRules.map((r) => <RuleRow key={r.id} r={r} fixed />)}</ul>
        </details>
      ) : null}
      {rules?.warnings.length ? (
        <details className="mt-3">
          <summary className="flex items-center gap-2 text-[14px] font-semibold">
            <CaretRightIcon size={12} className="caret text-ink-muted" aria-hidden /> Warnings ({rules.warnings.length}), not counted as errors
          </summary>
          <ul className="mt-1">{rules.warnings.map((r) => <RuleRow key={r.id} r={r} />)}</ul>
        </details>
      ) : null}
      {attempt.steps.length ? (
        <p className="mt-4 text-[12px] leading-5 text-ink-muted tnum">
          This try took {secs(attempt.ms)}:{" "}
          {attempt.steps.map((s, i) => `${SHORT_STEP[s.id] ?? s.id} ${secs(s.ms)}${i < attempt.steps.length - 1 ? ", " : "."}`)}
        </p>
      ) : null}
    </section>
  );
}
