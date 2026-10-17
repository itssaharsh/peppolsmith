"use client";

import NumberFlow from "@number-flow/react";
import { ProhibitIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { KeyboardEvent } from "react";
import type { Attempt, RunLog } from "@/lib/runlog";
import { amountRow, failedCount, money, STEP_LABEL } from "@/lib/client/format";
import { Ring, Tick } from "./glyphs";

export function outcomeText(a: Attempt, run: RunLog, prev: Attempt | undefined): string {
  const isLast = run.attempts[run.attempts.length - 1] === a;
  switch (a.outcome) {
    case "certified":
      return "Certified";
    case "held_reconciliation": {
      const r = amountRow(a);
      if (r && r.source !== null && r.xml !== null && r.xml !== r.source) return `Held: ${money(Math.abs(r.xml - r.source))} off the bill`;
      return "Held: totals don't tie";
    }
    case "held_provenance":
      return "Held: ID not in the source";
    case "no_xml":
      if (isLast && run.verdict === "no_release") return "Not released";
      return a.run?.networkBlocked ? "No XML: network blocked" : "No XML: map.py stopped";
    case "error":
      if (isLast && run.verdict === "no_release") return "Not released";
      return "Couldn't finish";
    case "rules_failed": {
      if (isLast && run.verdict === "no_release") return "Not released";
      if (a.n === 1 || !prev) return "Converter written";
      const before = [...run.attempts.slice(0, run.attempts.indexOf(a))].reverse().find((x) => x.rules);
      const now = a.rules?.failed.length ?? 0;
      const fixed = Math.max(a.rules?.fixed.length ?? 0, before?.rules ? before.rules.failed.length - now : 0);
      if (!before) return "First XML checked";
      return fixed > 0 ? `Fixed ${fixed}` : "None fixed yet";
    }
  }
}

type Props = {
  run: RunLog;
  selected: number;
  onSelect: (i: number, viaKeyboard: boolean) => void;
  pending: { stepIndex: number } | null;
  stopped: boolean;
};

export function Tally({ run, selected, onSelect, pending, stopped }: Props) {
  const attempts = run.attempts;
  const counts = attempts.map((a) => failedCount(a) ?? 0);
  const max = Math.max(1, ...counts);
  const slots = 6;
  const used = attempts.length + (pending ? 1 : 0);
  const finished = run.verdict !== "running" && !pending;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const n = attempts.length;
    if (!n) return;
    let next = selected;
    if (e.key === "ArrowRight") next = Math.min(n - 1, selected + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, selected - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    onSelect(next, true);
    const el = document.getElementById(`attempt-tab-${next}`);
    el?.focus();
  }

  return (
    <div data-region="tally">
      <p className="mb-2 text-[13px] text-ink-muted lg:hidden">Official rules failed, per attempt</p>
      <div
        role="tablist"
        aria-label="Attempts"
        onKeyDown={onKey}
        className="grid gap-1.5 sm:gap-4"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {attempts.map((a, i) => {
          const isSel = i === selected;
          const count = failedCount(a);
          const held = a.outcome === "held_reconciliation" || a.outcome === "held_provenance";
          const noXml = a.outcome === "no_xml" || a.outcome === "error" || count === null;
          const outcome = outcomeText(a, run, attempts[i - 1]);
          return (
            <button
              key={a.n}
              id={`attempt-tab-${i}`}
              role="tab"
              type="button"
              aria-selected={isSel}
              aria-controls="attempt-detail"
              tabIndex={isSel ? 0 : -1}
              onClick={() => onSelect(i, false)}
              className={`relative flex min-w-0 flex-col items-start rounded-md px-1.5 pb-3 pt-2 text-left transition-colors duration-150 sm:px-3 ${
                isSel ? "bg-surface-1" : "hover:bg-surface-2/60"
              }`}
            >
              <span className="whitespace-nowrap text-[12px] font-semibold text-ink-muted sm:text-[13px]">
                <span className="hidden sm:inline">Attempt </span>
                <span className="sm:hidden">#</span>
                {a.n}
              </span>
              <span
                className="relative mt-1 inline-flex items-center font-display font-extrabold leading-none tracking-[-0.03em] tnum"
                style={{ fontSize: "var(--text-num)", height: "calc(var(--text-num) * 1.05)" }}
              >
                {noXml ? (
                  <span className="flex flex-col items-start text-ink-muted">
                    {a.run?.networkBlocked ? (
                      <ProhibitIcon aria-hidden size="0.6em" />
                    ) : (
                      <WarningCircleIcon aria-hidden size="0.6em" />
                    )}
                  </span>
                ) : (
                  <span className="relative inline-block" style={{ ["--ring-h" as string]: "0.9em" }}>
                    <NumberFlow value={count ?? 0} format={{ useGrouping: false }} willChange />
                    {held ? <Ring scale={1.18} width={3} delay={i === selected ? 120 : 600} minAspect={1.5} /> : null}
                  </span>
                )}
              </span>
              <span className="text-[12px] text-ink-muted sm:text-[13px]">
                {noXml ? (a.outcome === "error" ? "no code" : "no XML") : "rules failed"}
              </span>
              <span className="mt-1.5 block h-1.5 w-full">
                {count ? (
                  <span
                    key={`${run.runId}-${a.n}`}
                    className="bar block h-1.5 rounded-sm bg-ink"
                    style={{ width: `${Math.max(6, (count / max) * 100)}%` }}
                  />
                ) : null}
              </span>
              <span
                className={`mt-2 flex items-start gap-1 text-[12px] font-semibold leading-snug sm:text-[13px] ${
                  a.outcome === "certified" ? "text-success" : held ? "text-hold" : "text-ink"
                }`}
              >
                {a.outcome === "certified" ? <Tick size={16} className="mt-px" /> : null}
                <span className="hidden sm:inline">{outcome}</span>
                <span className="sm:hidden">{a.outcome === "certified" ? "" : held ? "Held" : ""}</span>
              </span>
              {isSel ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-sm bg-ink" aria-hidden /> : null}
            </button>
          );
        })}
        {pending ? (
          <div className="flex min-w-0 flex-col items-start rounded-md px-1.5 pb-3 pt-2 sm:px-3" aria-live="polite">
            <span className="whitespace-nowrap text-[12px] font-semibold text-ink-muted sm:text-[13px]">
              <span className="hidden sm:inline">Attempt </span>
              <span className="sm:hidden">#</span>
              {attempts.length + 1}
            </span>
            <span
              className="mt-1 inline-flex items-center font-display font-extrabold leading-none text-ink-muted"
              style={{ fontSize: "var(--text-num)", height: "calc(var(--text-num) * 1.05)" }}
            >
              <span className="inline-flex gap-[0.12em]" aria-label="working">
                <span className="h-[0.12em] w-[0.12em] rounded-full bg-ink-muted" />
                <span className="h-[0.12em] w-[0.12em] rounded-full bg-ink-muted" />
                <span className="h-[0.12em] w-[0.12em] rounded-full bg-ink-muted" />
              </span>
            </span>
            <span className="shimmer text-[12px] sm:text-[13px]">{Object.values(STEP_LABEL)[pending.stepIndex]}</span>
          </div>
        ) : null}
        {finished && used > 0 && used < slots ? (
          <div
            className="hidden flex-col justify-center self-stretch pl-2 text-[13px] text-ink-muted sm:flex"
            style={{ gridColumn: `${used + 1} / span ${Math.min(2, slots - used)}` }}
          >
            {stopped
              ? `Stopped after attempt ${attempts.length}.`
              : run.verdict === "certified"
                ? `Released after ${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}. A run gets up to 6.`
                : `Ended after ${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}. A run gets up to 6.`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
