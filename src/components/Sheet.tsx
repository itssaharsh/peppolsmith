"use client";

import { CaretRightIcon, DownloadSimpleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import type { Attempt, Outcome, RuleCount, RunLog } from "@/lib/runlog";
import type { ReconRow } from "@/lib/gates";
import { amountRow, money, pdtTime, reconValue, secs } from "@/lib/client/format";
import { MiniRing, Ring, Tick } from "./glyphs";

export type GateSet = {
  rules: { failed: RuleCount[]; error?: string } | null;
  reconciliation: { rows: ReconRow[] } | null;
  provenance: { total: number; traced: number; untraced: { field: string; value: string }[] } | null;
  outcome: Outcome | "running" | "none";
};

export type FoolResult = {
  mutation: string;
  label: string;
  xml: string;
  rules: { failed: RuleCount[]; error?: string };
  reconciliation: { ties: boolean; rows: ReconRow[] };
  provenance: { total: number; traced: number; untraced: { field: string; value: string }[] };
  outcome: Outcome;
};

export type ConvertResult = {
  invoiceRef: string;
  label: string;
  ms: number;
  modelCalls: number;
  rules: { failed: RuleCount[]; error?: string };
  reconciliation: { ties: boolean; rows: ReconRow[] };
  provenance: { total: number; traced: number; untraced: { field: string; value: string }[] };
  outcome: Outcome;
  xml: string;
};

const MUTATIONS: { id: "cents" | "discount" | "buyer_id"; label: string }[] = [
  { id: "cents", label: "Treat cents as euros" },
  { id: "discount", label: "Drop the discount" },
  { id: "buyer_id", label: "Invent a buyer Peppol ID" },
];

function GateRow({ name, who, state, children }: { name: string; who: string; state: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">{name}</h3>
          <p className="text-[12px] leading-4 text-ink-muted">{who}</p>
        </div>
        <div className="shrink-0 pt-0.5 text-right text-[14px] font-semibold">{state}</div>
      </div>
      {children}
    </div>
  );
}

function TieOut({ rows }: { rows: ReconRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="tieout w-full border-collapse text-[14px] tnum">
        <thead>
          <tr className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <th className="py-1 pr-2 text-left font-semibold">Check</th>
            <th className="w-[96px] px-2 py-1 text-right font-semibold">Source</th>
            <th className="w-[96px] px-2 py-1 text-right font-semibold">XML</th>
            <th className="w-[30px] py-1 text-center font-semibold">
              <span className="sr-only">Mark</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.check} className="h-[30px] border-t border-line">
              <td className="py-1 pr-2 text-left">{r.check.replace(" (before VAT)", "")}</td>
              <td className="px-2 py-1 text-right">{reconValue(r, "source")}</td>
              <td className="px-2 py-1 text-right">
                <span className="relative inline-block">
                  {reconValue(r, "xml")}
                  {!r.ties ? <Ring scale={1.25} width={2.5} delay={200 + i * 60} /> : null}
                </span>
              </td>
              <td className="py-1 text-center">
                {r.ties ? (
                  <>
                    <Tick size={15} draw />
                    <span className="sr-only">agrees with the source</span>
                  </>
                ) : (
                  <span className="sr-only">doesn&apos;t agree</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function gatesFromAttempt(a: Attempt | null): GateSet {
  if (!a) return { rules: null, reconciliation: null, provenance: null, outcome: "none" };
  return { rules: a.rules, reconciliation: a.reconciliation, provenance: a.provenance, outcome: a.outcome };
}

export function Gates({ g, run, checking }: { g: GateSet; run: RunLog | null; checking: boolean }) {
  const rulesState = checking ? (
    <span className="text-ink-muted">Checking</span>
  ) : !g.rules ? (
    <span className="text-ink-muted">{g.outcome === "no_xml" || g.outcome === "error" ? "Didn't run" : "Not run yet"}</span>
  ) : g.rules.error ? (
    <span>Couldn&apos;t run</span>
  ) : g.rules.failed.length === 0 ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <Tick size={16} draw /> 0 failed
    </span>
  ) : (
    <span className="tnum">{g.rules.failed.length} failing</span>
  );
  const rows = g.reconciliation?.rows ?? null;
  const ties = rows ? rows.every((r) => r.ties) : false;
  const reconState = checking ? (
    <span className="text-ink-muted">Checking</span>
  ) : !rows ? (
    <span className="text-ink-muted">Not run yet</span>
  ) : ties ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <Tick size={16} draw /> All tie
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-hold">
      <MiniRing /> Doesn&apos;t tie
    </span>
  );
  const p = g.provenance;
  const provState = checking ? (
    <span className="text-ink-muted">Checking</span>
  ) : !p ? (
    <span className="text-ink-muted">Not run yet</span>
  ) : p.untraced.length === 0 ? (
    <span className="inline-flex items-center gap-1.5 text-success tnum">
      <Tick size={16} draw /> {p.traced} of {p.total} traced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-hold tnum">
      <MiniRing /> {p.untraced.length} not in the source
    </span>
  );
  const sets = run?.rulesets ?? [];
  return (
    <div className="mt-2">
      <GateRow
        name="Official rules"
        who={
          sets.length
            ? `${sets.map((s) => `${s.name.replace(" (UBL)", "")} ${s.version.replace("validation-", "v")}`).join(" and ")}, run in the CreateOS VM`
            : "CEN EN16931 and Peppol BIS Billing 3.0, run in the CreateOS VM"
        }
        state={rulesState}
      >
        {sets.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {sets.map((s) => (
              <li key={s.file} className="truncate font-mono text-[12px] text-ink-muted">
                {s.file} sha256 {s.sha256.slice(0, 8)}
              </li>
            ))}
          </ul>
        ) : null}
      </GateRow>
      <GateRow name="Reconciliation" who="Totals in the XML against the source record. Server, no model." state={reconState}>
        {rows ? (
          <TieOut rows={rows} />
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">Runs once map.py writes XML that passes the official rules.</p>
        )}
      </GateRow>
      <GateRow
        name="Provenance"
        who="Every party name, VAT ID, Peppol ID and IBAN must come from the source or the declared settings. Server, no model."
        state={provState}
      >
        {p && p.untraced.length ? (
          <ul className="mt-2 space-y-1">
            {p.untraced.map((u) => (
              <li key={u.field + u.value} className="text-[13px]">
                {u.field}{" "}
                <span className="relative inline-block font-mono">
                  {u.value}
                  <Ring scale={1.3} width={2.5} delay={200} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </GateRow>
    </div>
  );
}

function ReleasedOutputs(props: {
  locked: boolean;
  onXml: () => void;
  onCert: () => void;
  onConvert: () => void;
  convert: { loading: boolean; result?: ConvertResult; error?: string } | null;
  onConvertXml: () => void;
  sourceLabel: string;
  convertBlocked: string | null;
}) {
  const { locked, convert } = props;
  const lockedAttrs = locked ? { "aria-disabled": true as const } : {};
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" {...lockedAttrs} onClick={locked ? undefined : props.onXml} className="btn-tonal inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[14px] font-semibold">
          <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden /> Download XML
        </button>
        <button type="button" {...lockedAttrs} onClick={locked ? undefined : props.onCert} className="btn-tonal inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[14px] font-semibold">
          <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden />
          <span className="hidden sm:inline">Download certificate</span>
          <span className="sm:hidden">Certificate</span>
        </button>
      </div>
      {locked ? (
        <p className="mt-2 text-[13px] text-ink-muted">Downloads unlock when all three checks pass.</p>
      ) : (
        <>
          {props.convertBlocked ? (
            <p className="mt-3 text-[13px] text-ink-muted">{props.convertBlocked}</p>
          ) : (
            <>
              <button
                type="button"
                onClick={props.onConvert}
                aria-disabled={convert?.loading ? true : undefined}
                className="btn-tonal mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-md px-3 py-2 text-[14px] font-semibold"
              >
                {convert?.loading ? "Converting…" : "Convert a new invoice with the model off"}
              </button>
              <p className="mt-1.5 text-[12px] text-ink-muted">Runs the certified converter on a new invoice of the same shape. No model call.</p>
            </>
          )}
          {convert?.error ? <p className="rise-in mt-2 text-[14px]">Couldn&apos;t convert: {convert.error}</p> : null}
          {convert?.result ? <ConvertRow r={convert.result} onXml={props.onConvertXml} /> : null}
        </>
      )}
    </div>
  );
}

function ConvertRow({ r, onXml }: { r: ConvertResult; onXml: () => void }) {
  const failed = r.rules.failed.length;
  const ties = r.reconciliation.ties;
  const ok = r.outcome === "certified";
  return (
    <div className="rise-in mt-3 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]" role="status">
      {ok ? (
        <p>
          Converted {r.label ? <span className="font-semibold">{r.label}</span> : null}
          {r.invoiceRef ? <span className="font-mono text-[13px]"> {r.invoiceRef}</span> : null} in {secs(r.ms)} with {r.modelCalls} model calls. Official
          rules: {failed} failed. Totals {ties ? "tie" : "don't tie"}. {r.provenance.traced} of {r.provenance.total} IDs traced.
        </p>
      ) : failed > 0 ? (
        <p>
          The certified converter didn&apos;t handle this invoice: {failed} official {failed === 1 ? "rule fails" : "rules fail"}. Run live to build a new one.
        </p>
      ) : (
        <p>
          The certified converter&apos;s output for {r.invoiceRef || "this invoice"} was held: {ties ? "an ID isn't in the source" : "the totals don't tie"}. {r.modelCalls} model
          calls.
        </p>
      )}
      {r.xml ? (
        <button type="button" onClick={onXml} className="link mt-1 font-medium">
          Download this XML
        </button>
      ) : null}
    </div>
  );
}

type SheetProps = {
  run: RunLog | null;
  attempt: Attempt | null;
  sourceLabel: string;
  checking: boolean;
  stopped: boolean;
  validatorDown: { since: string } | null;
  fool: { loading: string | null; result: FoolResult | null; error: string | null; tally: { planted: number; passed: number; held: number } };
  canFool: boolean;
  foolBlocked: Partial<Record<"cents" | "discount" | "buyer_id", string>>;
  convertBlocked: string | null;
  onFool: (m: "cents" | "discount" | "buyer_id") => void;
  onFoolBack: () => void;
  convert: { loading: boolean; result?: ConvertResult; error?: string } | null;
  onConvert: () => void;
  onConvertXml: () => void;
  onXml: () => void;
  onCert: () => void;
};

export function Sheet(p: SheetProps) {
  const { run, attempt, fool } = p;
  const showingFool = !!fool.result;
  const g: GateSet = showingFool
    ? { rules: fool.result!.rules, reconciliation: fool.result!.reconciliation, provenance: fool.result!.provenance, outcome: fool.result!.outcome }
    : gatesFromAttempt(attempt);
  const outcome = g.outcome;
  const isLast = !!run && !!attempt && run.attempts[run.attempts.length - 1] === attempt;

  // residue: an earlier attempt held on totals, fixed by this one
  const earlierHeld =
    !showingFool && attempt && run
      ? run.attempts.slice(0, attempt.n - 1).find((a) => a.outcome === "held_reconciliation")
      : undefined;
  const heldRow = amountRow(earlierHeld);

  let verdict: ReactNode;
  if (p.checking) {
    verdict = (
      <div>
        <p className="text-[28px] font-extrabold leading-tight" style={{ fontSize: "var(--text-2xl)" }}>
          Checking
        </p>
        <p className="mt-1 text-[14px]">Waiting for the official rules.</p>
      </div>
    );
  } else if (outcome === "certified") {
    verdict = (
      <div className="fade-in">
        <p className="flex items-center gap-2 font-extrabold leading-tight text-success" style={{ fontSize: "var(--text-2xl)" }}>
          <Tick size={28} draw /> Certified
        </p>
        <p className="mt-1 text-[14px]">All three checks pass. The XML and this converter are released for the {p.sourceLabel}.</p>
      </div>
    );
  } else if (outcome === "held_reconciliation") {
    const r = showingFool ? fool.result!.reconciliation.rows.find((x) => /amount due/i.test(x.check)) : amountRow(attempt);
    const bad =
      g.reconciliation?.rows
        .filter((x) => !x.ties)
        .map((x) => {
          const c = x.check.replace(" (before VAT)", "");
          return c.startsWith("VAT") ? c : c.charAt(0).toLowerCase() + c.slice(1);
        }) ?? [];
    verdict = (
      <div className="fade-in rounded-md bg-hold-container p-4">
        <p className="font-extrabold leading-tight text-hold" style={{ fontSize: "var(--text-2xl)" }}>
          Held
        </p>
        <p className="mt-1 text-[15px]">The official rules pass, but the XML doesn&apos;t match what was billed.</p>
        {r && r.source !== null && r.xml !== null ? (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[20px] font-bold tnum">
            <dt className="self-center text-[14px] font-medium">Amount due in the XML</dt>
            <dd className="text-right">
              <span className="relative inline-block">
                {money(r.xml)}
                <Ring scale={1.3} width={2.5} delay={120} />
              </span>
            </dd>
            <dt className="self-center text-[14px] font-medium">Billed</dt>
            <dd className="text-right">{money(r.source)}</dd>
            <dt className="self-center text-[14px] font-medium">Off by</dt>
            <dd className="text-right text-hold">{money(Math.abs(r.xml - r.source))}</dd>
          </dl>
        ) : null}
        {bad.length ? <p className="mt-2 text-[14px]">Doesn&apos;t tie: {bad.join(", ")}.</p> : null}
        <p className="mt-1 text-[13px] text-ink-muted">Downloads stay locked until it ties.</p>
      </div>
    );
  } else if (outcome === "held_provenance") {
    const u = g.provenance?.untraced[0];
    verdict = (
      <div className="fade-in rounded-md bg-hold-container p-4">
        <p className="font-extrabold leading-tight text-hold" style={{ fontSize: "var(--text-2xl)" }}>
          Held
        </p>
        <p className="mt-1 text-[15px]">The official rules pass, but the XML contains an ID that isn&apos;t in the source.</p>
        {u ? (
          <p className="mt-2 text-[14px]">
            {u.field} <span className="font-mono text-[13px]">{u.value}</span> appears nowhere in the source or the declared settings.
          </p>
        ) : null}
        <p className="mt-1 text-[13px] text-ink-muted">Downloads stay locked until every ID traces.</p>
      </div>
    );
  } else if (outcome === "none") {
    verdict = (
      <div>
        <p className="font-extrabold leading-tight text-ink" style={{ fontSize: "var(--text-2xl)" }}>
          Not released yet
        </p>
        <p className="mt-1 text-[14px]">Nothing has run on this source yet.</p>
      </div>
    );
  } else {
    const n = g.rules?.failed.length ?? 0;
    const final = isLast && run?.verdict === "no_release";
    verdict = (
      <div className="fade-in">
        <p className="font-extrabold leading-tight text-ink" style={{ fontSize: "var(--text-2xl)" }}>
          {final ? "Not released" : "Not released yet"}
        </p>
        <p className="mt-1 text-[14px]">
          {final
            ? n > 0
              ? `${n} official ${n === 1 ? "rule still fails" : "rules still fail"} after ${run!.attempts.length} attempts. Nothing was released.`
              : `No attempt passed all three checks in ${run!.attempts.length} attempts. Nothing was released.`
            : outcome === "no_xml"
              ? "map.py wrote no XML in this attempt."
              : outcome === "error"
                ? "This attempt couldn't finish."
                : `${n} official ${n === 1 ? "rule still fails" : "rules still fail"}.`}
          {p.stopped && isLast ? ` Stopped after attempt ${attempt?.n}. Nothing was released.` : ""}
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="release-h" className="rounded-lg border border-line bg-surface-1 px-5 py-5 sm:px-6" data-region="sheet">
      {p.validatorDown ? (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]">
          <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <span>
            The validator VM isn&apos;t responding, so new results can&apos;t be checked. Showing the last verified result
            {p.validatorDown.since ? `, from ${pdtTime(p.validatorDown.since)}` : ""}.
          </span>
        </p>
      ) : null}
      <h2 id="release-h" className="text-[18px] font-extrabold">
        Release
      </h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">Nothing leaves until all three checks pass. The model can&apos;t edit them.</p>

      <div className="mt-4">
        {showingFool ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] font-semibold">
              Test change, not a model run: {fool.result!.label}
            </span>
            <button type="button" onClick={p.onFoolBack} className="link text-[13px] font-medium">
              Back to the certified result
            </button>
          </div>
        ) : null}
        <div aria-live="polite">{verdict}</div>
        {!showingFool && !p.checking && run && attempt ? (
          <ReleasedOutputs
            locked={outcome !== "certified"}
            onXml={p.onXml}
            onCert={p.onCert}
            onConvert={p.onConvert}
            convert={p.convert}
            onConvertXml={p.onConvertXml}
            sourceLabel={p.sourceLabel}
            convertBlocked={p.convertBlocked}
          />
        ) : null}
      </div>

      <div className="mt-5">
        <Gates g={g} run={run} checking={p.checking} />
        {earlierHeld && heldRow && heldRow.xml !== null && heldRow.source !== null && attempt?.outcome === "certified" ? (
          <p className="mt-1 flex items-start gap-2 text-[13px]">
            <MiniRing className="mt-1" /> Held at attempt {earlierHeld.n}: XML {money(heldRow.xml)}, billed {money(heldRow.source)}. Fixed in attempt{" "}
            {attempt.n}.
          </p>
        ) : null}
      </div>

      <details className="mt-4 border-t border-line pt-3" open={showingFool || undefined}>
        <summary className="flex items-center gap-2 text-[14px] font-semibold">
          <CaretRightIcon size={14} className="caret" aria-hidden /> Try to fool the gates
        </summary>
        <div className="pt-2">
          <p className="text-[13px] text-ink-muted">
            Each button changes the certified XML the way a buggy converter would, then runs all three checks again.
          </p>
          {p.canFool ? (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                {MUTATIONS.map((m) => {
                  const off = !!fool.loading || !!p.foolBlocked[m.id];
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-disabled={off ? true : undefined}
                      title={p.foolBlocked[m.id]}
                      onClick={() => (off ? undefined : p.onFool(m.id))}
                      className="btn-tonal h-9 rounded-md px-3 text-[13px] font-semibold"
                    >
                      {fool.loading === m.id ? "Checking…" : m.label}
                    </button>
                  );
                })}
              </div>
              {Object.entries(p.foolBlocked).map(([k, why]) => (
                <p key={k} className="mt-1.5 text-[12px] text-ink-muted">
                  {MUTATIONS.find((m) => m.id === k)?.label}: {why}
                </p>
              ))}
            </>
          ) : (
            <p className="mt-2 text-[13px]">Needs a certified result first.</p>
          )}
          {fool.error ? <p className="mt-2 text-[13px]">Couldn&apos;t run the test change: {fool.error}</p> : null}
          {fool.tally.planted > 0 ? (
            <p className="mt-2 text-[13px] tnum">
              Planted: {fool.tally.planted}. Passed the official rules: {fool.tally.passed}. Held: {fool.tally.held}.
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
