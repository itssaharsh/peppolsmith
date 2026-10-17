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

function GateRow({
  name,
  plain,
  state,
  failing,
  children,
}: {
  name: string;
  plain: string;
  state: ReactNode;
  failing: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">{name}</h3>
          <p className="text-[12px] leading-4 text-ink-muted">{plain}</p>
        </div>
        <div className="shrink-0 pt-0.5 text-right text-[14px] font-semibold">{state}</div>
      </div>
      {children ? (
        <details className="mt-1.5" open={failing || undefined}>
          <summary className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink">
            <CaretRightIcon size={12} className="caret" aria-hidden /> Details
          </summary>
          <div className="pt-1">{children}</div>
        </details>
      ) : null}
    </li>
  );
}

function TieOut({ rows }: { rows: ReconRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="tieout w-full border-collapse text-[14px] tnum">
        <thead>
          <tr className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <th className="py-1 pr-2 text-left font-semibold">Check</th>
            <th className="w-[96px] px-2 py-1 text-right font-semibold">Bill</th>
            <th className="w-[96px] px-2 py-1 text-right font-semibold">E-invoice</th>
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
                    <span className="sr-only">matches the bill</span>
                  </>
                ) : (
                  <span className="sr-only">doesn&apos;t match the bill</span>
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
  const pass = (label: string) => (
    <span className="inline-flex items-center gap-1.5 text-success tnum">
      <Tick size={16} draw /> {label}
    </span>
  );
  const fail = (label: string) => (
    <span className="inline-flex items-center gap-1.5 text-hold tnum">
      <MiniRing /> {label}
    </span>
  );
  const muted = (label: string) => <span className="text-ink-muted">{label}</span>;

  const rulesFailing = !!g.rules && !g.rules.error && g.rules.failed.length > 0;
  const rulesState = checking
    ? muted("Checking")
    : !g.rules
      ? muted(g.outcome === "no_xml" || g.outcome === "error" ? "Nothing to check" : "Not checked yet")
      : g.rules.error
        ? <span>Couldn&apos;t run</span>
        : g.rules.failed.length === 0
          ? pass("Passed")
          : <span className="tnum">{g.rules.failed.length} {g.rules.failed.length === 1 ? "error" : "errors"}</span>;

  const rows = g.reconciliation?.rows ?? null;
  const ties = rows ? rows.every((r) => r.ties) : false;
  const reconState = checking ? muted("Checking") : !rows ? muted("Not checked yet") : ties ? pass("Match") : fail("Don't match");

  const p = g.provenance;
  const provState = checking
    ? muted("Checking")
    : !p
      ? muted("Not checked yet")
      : p.untraced.length === 0
        ? pass(`${p.traced} of ${p.total}`)
        : fail(`${p.untraced.length} invented`);

  const sets = run?.rulesets ?? [];
  return (
    <ul className="mt-2" aria-label="The three checks">
      <GateRow
        name="Follows the EU e-invoice rules"
        plain="The official EU checker, run inside the locked sandbox."
        state={rulesState}
        failing={rulesFailing}
      >
        <p className="text-[12px] leading-4 text-ink-muted">
          {sets.length
            ? `${sets.map((s) => `${s.name.replace(" (UBL)", "")} ${s.version.replace("validation-", "v")}`).join(" and ")}, run in the CreateOS VM by Peppolsmith, not by the AI's code. Rule files:`
            : "CEN EN16931 and Peppol BIS Billing 3.0, run in the CreateOS VM."}
        </p>
        {sets.length ? (
          <ul className="mt-1 space-y-0.5">
            {sets.map((s) => (
              <li key={s.file} className="truncate font-mono text-[12px] text-ink-muted">
                {s.file} sha256 {s.sha256.slice(0, 8)}
              </li>
            ))}
          </ul>
        ) : null}
      </GateRow>
      <GateRow
        name="Totals match the bill"
        plain="Lines, VAT and amount due compared with the original invoice. No AI involved."
        state={reconState}
        failing={!!rows && !ties}
      >
        {rows ? (
          <TieOut rows={rows} />
        ) : (
          <p className="text-[13px] text-ink-muted">Runs once the code produces an invoice that passes the EU rules.</p>
        )}
      </GateRow>
      <GateRow
        name="Company IDs come from the invoice"
        plain="Every name, VAT number, Peppol ID and IBAN must appear in the original or the declared settings. No AI involved."
        state={provState}
        failing={!!p && p.untraced.length > 0}
      >
        {p ? (
          p.untraced.length ? (
            <ul className="space-y-1">
              {p.untraced.map((u) => (
                <li key={u.field + u.value} className="text-[13px]">
                  {u.field}{" "}
                  <span className="relative inline-block font-mono">
                    {u.value}
                    <Ring scale={1.3} width={2.5} delay={200} />
                  </span>{" "}
                  is not in the original invoice.
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-muted tnum">
              {p.traced} of {p.total} names and IDs in the e-invoice were found in the original invoice or the declared settings.
            </p>
          )
        ) : (
          <p className="text-[13px] text-ink-muted">Runs once the code produces an invoice that passes the EU rules.</p>
        )}
      </GateRow>
    </ul>
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
          <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden /> E-invoice (XML)
        </button>
        <button type="button" {...lockedAttrs} onClick={locked ? undefined : props.onCert} className="btn-tonal inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[14px] font-semibold">
          <DownloadSimpleIcon size={18} className="shrink-0" aria-hidden />
          Certificate
        </button>
      </div>
      {locked ? (
        <p className="mt-2 text-[13px] text-ink-muted">Downloads unlock when all 3 checks pass.</p>
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
                {convert?.loading ? "Converting…" : "Convert another invoice, AI off"}
              </button>
              <p className="mt-1.5 text-[12px] text-ink-muted">Reuses the approved converter on a new invoice of the same kind. No AI call.</p>
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
          {r.invoiceRef ? <span className="font-mono text-[13px]"> {r.invoiceRef}</span> : null} in {secs(r.ms)} with {r.modelCalls} AI calls. EU rules:{" "}
          {failed} errors. Totals {ties ? "match" : "don't match"}. {r.provenance.traced} of {r.provenance.total} IDs from the invoice.
        </p>
      ) : failed > 0 ? (
        <p>
          The approved converter didn&apos;t handle this invoice: {failed} EU rule {failed === 1 ? "error" : "errors"}. Run live to build a new one.
        </p>
      ) : (
        <p>
          The approved converter&apos;s output for {r.invoiceRef || "this invoice"} was held back: {ties ? "an ID isn't in the invoice" : "the totals don't match"}.{" "}
          {r.modelCalls} AI calls.
        </p>
      )}
      {r.xml ? (
        <button type="button" onClick={onXml} className="link mt-1 font-medium">
          Download this e-invoice
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

  const big = { fontSize: "var(--text-2xl)" };
  let verdict: ReactNode;
  if (p.checking) {
    verdict = (
      <div>
        <p className="font-extrabold leading-tight" style={big}>
          Checking
        </p>
        <p className="mt-1 text-[14px]">The AI is working on this try. The checks run as soon as its code produces an invoice.</p>
      </div>
    );
  } else if (outcome === "certified") {
    verdict = (
      <div className="fade-in">
        <p className="flex items-center gap-2 font-extrabold leading-tight text-success" style={big}>
          <Tick size={28} draw /> Ready to send
        </p>
        <p className="mt-1 text-[15px] font-semibold">Passed all 3 checks.</p>
        <p className="mt-0.5 text-[14px]">The e-invoice and the converter that made it are released. The next invoice of this kind converts with no AI.</p>
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
    const has = r && r.source !== null && r.xml !== null;
    verdict = (
      <div className="fade-in rounded-md bg-hold-container p-4">
        <p className="font-extrabold leading-tight text-hold" style={big}>
          Held back
        </p>
        <p className="mt-1 text-[15px]">
          {has
            ? `The EU rules pass, but the amount due is ${money(r!.xml!)} and the bill says ${money(r!.source!)}.`
            : "The EU rules pass, but the totals don't match the bill."}
        </p>
        {has ? (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[20px] font-bold tnum">
            <dt className="self-center text-[14px] font-medium">Amount due in the e-invoice</dt>
            <dd className="text-right">
              <span className="relative inline-block">
                {money(r!.xml!)}
                <Ring scale={1.3} width={2.5} delay={120} />
              </span>
            </dd>
            <dt className="self-center text-[14px] font-medium">The bill says</dt>
            <dd className="text-right">{money(r!.source!)}</dd>
            <dt className="self-center text-[14px] font-medium">Off by</dt>
            <dd className="text-right text-hold">{money(Math.abs(r!.xml! - r!.source!))}</dd>
          </dl>
        ) : null}
        {bad.length ? <p className="mt-2 text-[14px]">Doesn&apos;t match: {bad.join(", ")}.</p> : null}
        <p className="mt-1 text-[13px] text-ink-muted">Nothing can be downloaded until the totals match.</p>
      </div>
    );
  } else if (outcome === "held_provenance") {
    const u = g.provenance?.untraced[0];
    verdict = (
      <div className="fade-in rounded-md bg-hold-container p-4">
        <p className="font-extrabold leading-tight text-hold" style={big}>
          Held back
        </p>
        <p className="mt-1 text-[15px]">The EU rules pass, but the e-invoice has a company ID that isn&apos;t in the original invoice.</p>
        {u ? (
          <p className="mt-2 text-[14px]">
            {u.field} <span className="font-mono text-[13px]">{u.value}</span> appears nowhere in the original or the declared settings.
          </p>
        ) : null}
        <p className="mt-1 text-[13px] text-ink-muted">Nothing can be downloaded until every ID comes from the invoice.</p>
      </div>
    );
  } else if (outcome === "none") {
    verdict = (
      <div>
        <p className="font-extrabold leading-tight text-ink" style={big}>
          Not ready
        </p>
        <p className="mt-1 text-[14px]">Nothing has run on this invoice yet. Press Run live to start.</p>
      </div>
    );
  } else {
    const n = g.rules?.failed.length ?? 0;
    const tries = run?.attempts.length ?? 0;
    const final = isLast && run?.verdict === "no_release";
    const errs = `${n} ${n === 1 ? "error" : "errors"} left`;
    verdict = (
      <div className="fade-in">
        <p className="font-extrabold leading-tight text-ink" style={big}>
          Not ready
        </p>
        <p className="mt-1 text-[15px]">
          {final
            ? n > 0
              ? `${errs} after ${tries} tries. Nothing was released.`
              : `No try passed all 3 checks in ${tries} tries. Nothing was released.`
            : outcome === "no_xml"
              ? "The AI's code crashed in this try, so there was no invoice to check."
              : outcome === "error"
                ? "The AI sent back no code in this try."
                : `${errs} in this try. The AI fixes them in the next one.`}
          {p.stopped && isLast ? ` Stopped after try ${attempt?.n}. Nothing was released.` : ""}
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
            The EU checker in the sandbox isn&apos;t responding, so new results can&apos;t be checked. Showing the last checked result
            {p.validatorDown.since ? `, from ${pdtTime(p.validatorDown.since)}` : ""}.
          </span>
        </p>
      ) : null}
      <h2 id="release-h" className="text-[13px] font-semibold text-ink-muted">
        Result{attempt && !showingFool ? ` of try ${attempt.n}` : ""}
      </h2>

      <div className="mt-4">
        {showingFool ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] font-semibold">
              Test change, not an AI run: {fool.result!.label}
            </span>
            <button type="button" onClick={p.onFoolBack} className="link text-[13px] font-medium">
              Back to the real result
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
        <h3 className="text-[13px] font-semibold text-ink-muted">The 3 checks. The AI can&apos;t change them.</h3>
        <Gates g={g} run={run} checking={p.checking} />
        {earlierHeld && heldRow && heldRow.xml !== null && heldRow.source !== null && attempt?.outcome === "certified" ? (
          <p className="mt-1 flex items-start gap-2 text-[13px]">
            <MiniRing className="mt-1" /> Held back at try {earlierHeld.n}: e-invoice {money(heldRow.xml)}, bill {money(heldRow.source)}. Fixed in try{" "}
            {attempt.n}.
          </p>
        ) : null}
      </div>

      <details className="mt-4 border-t border-line pt-3" open={showingFool || undefined}>
        <summary className="flex items-center gap-2 text-[14px] font-semibold">
          <CaretRightIcon size={14} className="caret" aria-hidden /> Try to fool the checks
        </summary>
        <div className="pt-2">
          <p className="text-[13px] text-ink-muted">
            Each button plants a bug a careless converter could make in the approved e-invoice, then runs all 3 checks again.
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
            <p className="mt-2 text-[13px]">Needs an approved result first.</p>
          )}
          {fool.error ? <p className="mt-2 text-[13px]">Couldn&apos;t run the test change: {fool.error}</p> : null}
          {fool.tally.planted > 0 ? (
            <p className="mt-2 text-[13px] tnum">
              Bugs planted: {fool.tally.planted}. Passed the EU rules anyway: {fool.tally.passed}. Held back: {fool.tally.held}.
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
