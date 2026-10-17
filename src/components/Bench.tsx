"use client";

import { CaretDownIcon, PlayIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, RunLog } from "@/lib/runlog";
import {
  amountRow,
  clock,
  downloadBlob,
  isSource,
  money,
  pdt,
  runModel,
  sha256Hex,
  SOURCES,
  sourceLabel,
  type SourceKey,
} from "@/lib/client/format";
import { buildPreview, isPreview, type PreviewState } from "@/lib/client/fixtures";
import { Tally, outcomeText } from "./Tally";
import { ChangePane, Checklist, RulesList } from "./Detail";
import { Sheet, type ConvertResult, type FoolResult } from "./Sheet";
import { AboutCard, CreateOSPanel, Footer, JudgePopover, StripePanel, type Health } from "./Panels";
import { TopBar } from "./TopBar";

type Live = {
  source: SourceKey;
  run: RunLog | null;
  phase: "starting" | "stepping" | "done" | "stopped" | "error";
  error?: string;
  startedAt: number;
  stepStartedAt: number;
};
type Banner = { kind: "busy" | "cap" | "error"; text: string } | null;
type FoolState = { loading: string | null; result: FoolResult | null; error: string | null; tally: { planted: number; passed: number; held: number } };
type Mutation = "cents" | "discount" | "buyer_id";

const EMPTY_FOOL: FoolState = { loading: null, result: null, error: null, tally: { planted: 0, passed: 0, held: 0 } };

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: T & { error?: string; reason?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  let data: T & { error?: string; reason?: string };
  try {
    data = await res.json();
  } catch {
    data = { error: res.status === 404 ? "this endpoint isn't available yet" : `the server answered ${res.status}` } as T & { error?: string };
  }
  return { ok: res.ok, status: res.status, data };
}

function announceFor(a: Attempt): string {
  if (a.outcome === "certified") return "Ready to send. Downloads are ready.";
  if (a.outcome === "held_reconciliation") {
    const r = amountRow(a);
    if (r && r.xml !== null && r.source !== null) return `Held back: the amount due is ${money(r.xml)} and the bill says ${money(r.source)}.`;
    return "Held back: the totals don't match the bill.";
  }
  if (a.outcome === "held_provenance") return "Held back: an ID isn't from the invoice.";
  const n = a.rules?.failed.length;
  return `Try ${a.n} finished: ${n ?? "no"} errors left.`;
}

export function Bench() {
  const [ready, setReady] = useState(false);
  const [replays, setReplays] = useState<Partial<Record<SourceKey, RunLog | null>>>({});
  const [source, setSource] = useState<SourceKey>("stripe");
  const [defaultSource, setDefaultSource] = useState<SourceKey>("stripe");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [fool, setFool] = useState<FoolState>(EMPTY_FOOL);
  const [convert, setConvert] = useState<{ loading: boolean; result?: ConvertResult; error?: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [now, setNow] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [phoneChange, setPhoneChange] = useState(false);
  // our own live run holds the server's lock; ignore health.busy while it runs and for a short while after
  const [suppressBusy, setSuppressBusy] = useState(false);
  const loadHealthRef = useRef<() => void>(() => undefined);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  /* ---------- load replays, URL state, health ---------- */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("record") === "1") document.documentElement.setAttribute("data-record", "");
    const keys: SourceKey[] = ["stripe", "cii", "csv"];
    Promise.all(
      keys.map((k) =>
        fetch(`/replay/${k}.json`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<RunLog>) : null))
          .catch(() => null),
      ),
    ).then((logs) => {
      const map: Partial<Record<SourceKey, RunLog | null>> = {};
      keys.forEach((k, i) => (map[k] = logs[i] && Array.isArray(logs[i]!.attempts) ? logs[i] : null));
      setReplays(map);
      const qs = q.get("source");
      const cii = map.cii;
      const def: SourceKey = isSource(qs) ? qs : cii && cii.verdict === "certified" && cii.attempts.length > 1 ? "cii" : "stripe";
      setSource(def);
      setDefaultSource(cii && cii.verdict === "certified" && cii.attempts.length > 1 ? "cii" : "stripe");
      const st = q.get("state");
      if (isPreview(st)) setPreviewState(st);
      const at = Number(q.get("attempt"));
      if (at > 0) setSelected(at - 1);
      setReady(true);
      if (q.get("judge") === "1") {
        const el = document.getElementById("judge") as (HTMLElement & { showPopover?: () => void }) | null;
        try {
          el?.showPopover?.();
        } catch {
          /* already open */
        }
      }
    });
  }, []);

  // sponsor panel and busy state from /api/health; optional, ignored when it fails
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((h: Health | null) => {
          if (alive && h && typeof h.vmId === "string") setHealth(h);
        })
        .catch(() => undefined);
    loadHealthRef.current = () => void load();
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  /* ---------- derived view ---------- */
  const replay = replays[source] ?? null;
  const preview = useMemo(
    () => (previewState ? buildPreview(previewState, replay, Object.values(replays).filter(Boolean) as RunLog[]) : null),
    [previewState, replay, replays],
  );
  const liveHere = live && live.source === source ? live : null;
  const run: RunLog | null = liveHere ? liveHere.run : preview ? preview.run : replay;
  const liveRunning = !!liveHere && (liveHere.phase === "starting" || liveHere.phase === "stepping");
  const anyLiveRunning = !!live && (live.phase === "starting" || live.phase === "stepping");
  const previewRunning = !liveHere && previewState === "running" && !!run;
  const running = liveRunning || previewRunning;
  const attempts = run?.attempts ?? [];
  const defaultSel = preview && !liveHere && preview.selected !== null ? preview.selected : attempts.length - 1;
  const selIdx = attempts.length ? Math.max(0, Math.min(selected ?? defaultSel, attempts.length - 1)) : -1;
  const attempt = selIdx >= 0 ? attempts[selIdx] : null;
  const stopped = !!liveHere && liveHere.phase === "stopped";

  // a tick for elapsed timers while something runs
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const stepElapsed = liveRunning ? Math.max(0, now - (liveHere!.stepStartedAt || now)) : previewRunning ? (preview?.runningSince ?? 0) : 0;
  const writeMsSeen = attempts.map((a) => a.steps.find((s) => s.id === "write")?.ms ?? 0).filter((v) => v > 0);
  const expectedWrite = Math.max(20000, writeMsSeen.length ? writeMsSeen.reduce((x, y) => x + y, 0) / writeMsSeen.length : 30000);
  const stepIndex = stepElapsed < expectedWrite ? 0 : stepElapsed < expectedWrite + 1500 ? 1 : 2;

  /* ---------- actions ---------- */
  const resetExtras = () => {
    setFool(EMPTY_FOOL);
    setConvert(null);
  };

  const chooseSource = (k: SourceKey) => {
    if (anyLiveRunning) return;
    setSource(k);
    setSelected(null);
    resetExtras();
    const q = new URLSearchParams(window.location.search);
    q.set("source", k);
    q.delete("attempt");
    window.history.replaceState(null, "", `?${q.toString()}`);
  };

  const runLive = useCallback(async () => {
    if (anyLiveRunning) return;
    setBanner(null);
    setPreviewState(null);
    resetExtras();
    setSelected(null);
    stopRef.current = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = Date.now();
    const src = source;
    setLive({ source: src, run: null, phase: "starting", startedAt: t0, stepStartedAt: t0 });
    setAnnounce("Live run starting.");
    setSuppressBusy(true);
    try {
      const start = await postJson<RunLog>("/api/run", { source: src }, ctrl.signal);
      if (!start.ok) {
        setLive(null);
        if (start.status === 409 || start.data.reason === "busy")
          setBanner({
            kind: "busy",
            text: "A live run is already going. Live runs go one at a time; try again in a few minutes, or use the recorded run.",
          });
        else if (start.status === 429 || start.data.reason === "cap")
          setBanner({ kind: "cap", text: "Today's live runs are used up. The recorded run and the model-off converter still work." });
        else setBanner({ kind: "error", text: `Couldn't start a live run: ${start.data.error ?? `the server answered ${start.status}`}.` });
        return;
      }
      let cur = start.data as RunLog;
      setLive({ source: src, run: cur, phase: "stepping", startedAt: t0, stepStartedAt: Date.now() });
      while (cur.verdict === "running" && !stopRef.current) {
        const step = await postJson<RunLog>("/api/step", { run: cur }, ctrl.signal);
        if (!step.ok || !step.data || !Array.isArray((step.data as RunLog).attempts)) {
          const msg = step.data?.error ?? `the server answered ${step.status}`;
          setLive((l) => (l ? { ...l, run: cur, phase: "error", error: `The run stopped: ${msg}. The tries so far are kept.` } : l));
          return;
        }
        cur = step.data as RunLog;
        const lastA = cur.attempts[cur.attempts.length - 1];
        if (lastA) setAnnounce(announceFor(lastA));
        setSelected(null);
        setLive({ source: src, run: cur, phase: cur.verdict === "running" ? "stepping" : "done", startedAt: t0, stepStartedAt: Date.now() });
      }
      if (stopRef.current) setLive((l) => (l ? { ...l, phase: "stopped" } : l));
    } catch (e) {
      if (ctrl.signal.aborted) {
        setLive((l) => (l ? { ...l, phase: l.run ? "stopped" : "error", error: l.run ? undefined : "Stopped before the first try." } : l));
      } else {
        setLive((l) =>
          l ? { ...l, phase: "error", error: `The connection dropped: ${(e as Error).message}. The tries so far are kept.` } : l,
        );
      }
    } finally {
      // re-check the lock once our run has let go of it
      setTimeout(() => loadHealthRef.current(), 2000);
      setTimeout(() => {
        setSuppressBusy(false);
        loadHealthRef.current();
      }, 15000);
    }
  }, [anyLiveRunning, source]);

  const stop = () => {
    stopRef.current = true;
    abortRef.current?.abort();
  };

  const resetAll = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    setLive(null);
    setPreviewState(null);
    setBanner(null);
    setSelected(null);
    setFool(EMPTY_FOOL);
    setConvert(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === "KeyR") {
        e.preventDefault();
        resetAll();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        if (!anyLiveRunning) {
          setLive(null);
          setPreviewState(null);
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetAll, anyLiveRunning]);

  const xmlFor = (a: Attempt | null) => a?.xml ?? (a && run && run.attempts[run.attempts.length - 1] === a ? run.xml : undefined);

  const downloadXml = () => {
    const x = xmlFor(attempt);
    if (!x || !run) {
      setAnnounce("This recording has no XML for that attempt.");
      return;
    }
    downloadBlob(`peppol-${source}-${run.runId}.xml`, x, "application/xml");
  };

  const downloadCert = async () => {
    if (!run || !attempt) return;
    const x = xmlFor(attempt);
    const m = attempt.model;
    const cert = {
      certificate: "Peppolsmith release certificate",
      runId: run.runId,
      mode: run.mode,
      recordedAt: run.recordedAt,
      source: { kind: run.source.kind, label: run.source.label, ref: run.source.ref, provenance: run.source.provenance },
      model: { id: m?.id ?? run.model.id, provider: m?.provider ?? null, callsThisRun: run.model.calls, costUsdThisRun: run.model.costUsd },
      sandbox: { provider: "CreateOS", vmId: run.sandbox.vmId, image: run.sandbox.image, shape: run.sandbox.shape, network: run.sandbox.network },
      rulesets: run.rulesets,
      attempt: attempt.n,
      attemptsInRun: run.attempts.length,
      gates: {
        officialRules: { failed: attempt.rules?.failed.length ?? null, failedIds: attempt.rules?.failed.map((r) => r.id) ?? [] },
        reconciliation: { allTie: attempt.reconciliation?.rows.every((r) => r.ties) ?? null, rows: attempt.reconciliation?.rows ?? [] },
        provenance: attempt.provenance,
      },
      heldEarlier: run.attempts
        .slice(0, attempt.n - 1)
        .filter((a) => a.outcome === "held_reconciliation" || a.outcome === "held_provenance")
        .map((a) => ({ attempt: a.n, outcome: a.outcome })),
      mapPySha256: attempt.code ? await sha256Hex(attempt.code) : null,
      xmlSha256: x ? await sha256Hex(x) : null,
      verdict: attempt.outcome,
      generatedAt: new Date().toISOString(),
      note: "Generated in the browser from the run log shown on the page.",
    };
    downloadBlob(`peppolsmith-certificate-${source}-${run.runId}.json`, JSON.stringify(cert, null, 2), "application/json");
  };

  const doConvert = async () => {
    if (convert?.loading) return;
    setConvert({ loading: true });
    try {
      const r = await postJson<ConvertResult>("/api/convert", { source });
      if (!r.ok || r.data.error || !r.data.rules) setConvert({ loading: false, error: r.data.error ?? `the server answered ${r.status}` });
      else {
        setConvert({ loading: false, result: r.data });
        setAnnounce(`Converted with the model off in ${(r.data.ms / 1000).toFixed(1)} seconds.`);
      }
    } catch (e) {
      setConvert({ loading: false, error: (e as Error).message });
    }
  };

  const doFool = async (mutation: Mutation) => {
    if (fool.loading) return;
    setFool((f) => ({ ...f, loading: mutation, error: null }));
    try {
      const r = await postJson<FoolResult>("/api/fool", { source, mutation });
      if (!r.ok || r.data.error || !r.data.rules) {
        setFool((f) => ({ ...f, loading: null, error: r.data.error ?? `the server answered ${r.status}` }));
        return;
      }
      const res = r.data;
      const passed = !res.rules.error && res.rules.failed.length === 0;
      const held = res.outcome !== "certified";
      setFool((f) => ({
        loading: null,
        error: null,
        result: res,
        tally: { planted: f.tally.planted + 1, passed: f.tally.passed + (passed ? 1 : 0), held: f.tally.held + (held ? 1 : 0) },
      }));
      setAnnounce(held ? `Test change held: ${res.label}.` : `Test change released: ${res.label}.`);
    } catch (e) {
      setFool((f) => ({ ...f, loading: null, error: (e as Error).message }));
    }
  };

  const downloadConvertXml = () => {
    if (convert?.result?.xml) downloadBlob(`peppol-${source}-model-off-${convert.result.invoiceRef || "invoice"}.xml`, convert.result.xml, "application/xml");
  };

  /* ---------- copy ---------- */
  const model = runModel(run ?? replay);
  const busy = !!preview?.busy || banner?.kind === "busy" || (!!health?.busy && !anyLiveRunning && !suppressBusy);
  const capped = banner?.kind === "cap" || (!!health && health.dailyCap > 0 && health.runsToday >= health.dailyCap);
  const validatorDown = !liveHere && preview?.validatorDown ? { since: replay?.recordedAt ?? "" } : null;
  const blockedReason = busy
    ? "A live run is already going. Live runs go one at a time."
    : capped
      ? "Today's live runs are used up."
      : validatorDown
        ? "The validator VM isn't responding."
        : null;

  let runLabelLead = "";
  let runLabelRest = "";
  if (liveHere) {
    if (liveHere.phase === "starting" || liveHere.phase === "stepping") {
      runLabelLead = "Live run";
      runLabelRest = `, ${clock(now - liveHere.startedAt)} so far, in CreateOS VM ${liveHere.run?.sandbox.vmId ?? ""}`.replace(/ in CreateOS VM $/, "") + ".";
    } else if (liveHere.phase === "stopped") {
      runLabelLead = "Live run";
      runLabelRest = `. Stopped after try ${liveHere.run?.attempts.length ?? 0}. Nothing was released.`;
    } else if (liveHere.phase === "error") {
      runLabelLead = "Live run";
      runLabelRest = `. Couldn't finish after try ${liveHere.run?.attempts.length ?? 0}.`;
    } else {
      runLabelLead = "Live run";
      runLabelRest = `, ${pdt(liveHere.run?.recordedAt)}, in CreateOS VM ${liveHere.run?.sandbox.vmId ?? ""}.`;
    }
  } else if (previewState) {
    runLabelLead = "State preview";
    runLabelRest =
      previewState === "idle"
        ? ": idle. Nothing has run on this source in this view."
        : `: ${previewState}. ${replay ? "Built from the recorded run." : "No recorded run for this source yet."}`;
  } else if (replay) {
    runLabelLead = "Replay";
    runLabelRest = ` of a real recorded run from ${pdt(replay.recordedAt)}. Press Run live to watch it happen now.`;
  } else if (ready) {
    runLabelLead = "No recording";
    runLabelRest = " for this invoice yet.";
  }

  const runButtonLabel = liveRunning
    ? `Running try ${(liveHere?.run?.attempts.length ?? 0) + 1}`
    : liveHere && liveHere.phase !== "starting"
      ? "Run again"
      : "Run live";

  const replayDefault = replays[defaultSource] ?? null;
  const firstCount = replayDefault?.attempts.find((a) => a.rules)?.rules?.failed.length ?? null;
  const srcMeta = SOURCES.find((s) => s.key === source)!;
  const provenanceLine = run?.source.provenance || replay?.source.provenance || srcMeta.provenance;
  const showChecklist = running;

  return (
    <div id="top" className="mx-auto w-full max-w-[1440px] px-4 lg:px-8">
      <TopBar page="home" />
      <JudgePopover first={firstCount} attempts={replayDefault?.attempts.length ?? 0} />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <main className="mt-5 flex flex-col gap-6 lg:mt-6 lg:grid lg:grid-cols-12 lg:gap-x-6 lg:gap-y-0">
        {/* left block */}
        <div className="contents lg:col-span-7 lg:flex lg:min-w-0 lg:flex-col lg:gap-7 xl:col-span-8">
          <div className="order-1 lg:order-none">
            <h1 className="max-w-[40ch] font-display font-extrabold tracking-[-0.02em]" style={{ fontSize: "var(--text-xl)", lineHeight: 1.25 }}>
              Turn the invoices your billing tool already makes into <span className="whitespace-nowrap">EU e-invoices,</span> checked before they go
              out.
            </h1>
            <p className="mt-1.5 max-w-[70ch] text-[13px] leading-[18px] text-ink-muted lg:text-[14px] lg:leading-5">
              Since 1 January 2026 Belgian businesses must send Peppol e-invoices, and most billing tools can&apos;t make them.{" "}
              <Link href="/about" className="link text-ink">
                What is this?
              </Link>
            </p>
            <ol className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2" aria-label="How it works">
              {["Pick an invoice", "The AI writes and fixes a converter", "Released only if 3 checks pass"].map((t, i) => (
                <li
                  key={t}
                  className="flex flex-col items-start gap-1 rounded-md bg-surface-2 px-2.5 py-2 text-[12px] font-semibold leading-tight sm:flex-row sm:items-center sm:gap-2.5 sm:px-3 sm:text-[13px] lg:text-[14px]"
                >
                  <span className="font-display text-[18px] font-extrabold leading-none tnum sm:text-[20px]">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
            <p className="mt-2 hidden flex-wrap gap-x-5 gap-y-0.5 text-[12px] text-ink-muted sm:flex lg:text-[13px]">
              <span>
                <span className="font-semibold text-ink">AI:</span> {model.name}, through {model.provider}
              </span>
              <span>
                <span className="font-semibold text-ink">Runs in:</span> a CreateOS sandbox, no internet
              </span>
              <span>
                <span className="font-semibold text-ink">Set up with:</span> Stripe Projects
              </span>
            </p>
          </div>

          {/* run bar */}
          <div className="order-2 lg:order-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <label className="block sm:hidden">
                <span className="mb-1 block text-[13px] font-semibold text-ink-muted">Invoice to convert</span>
                <span className="relative block">
                  <select
                    value={source}
                    disabled={anyLiveRunning}
                    onChange={(e) => chooseSource(e.target.value as SourceKey)}
                    className="h-11 w-full appearance-none rounded-md border border-line-input bg-surface-1 px-3 pr-9 text-[15px] font-semibold"
                  >
                    {SOURCES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <CaretDownIcon size={16} className="pointer-events-none absolute right-3 top-3.5 text-ink-muted" aria-hidden />
                </span>
              </label>
              <div role="radiogroup" aria-label="Invoice to convert" className="hidden h-11 rounded-md bg-surface-2 p-1 sm:inline-flex">
                {SOURCES.map((s) => {
                  const on = s.key === source;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={anyLiveRunning && !on ? true : undefined}
                      title={anyLiveRunning && !on ? "Locked while this run is going" : undefined}
                      onClick={() => chooseSource(s.key)}
                      className={`rounded-[5px] px-3 text-[14px] transition-colors duration-150 xl:px-4 ${
                        on
                          ? "bg-surface-1 font-semibold text-ink shadow-[0_0_0_1px_var(--line-input)]"
                          : "font-medium text-ink-muted hover:bg-[color-mix(in_oklch,var(--ink)_8%,transparent)]"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={blockedReason || liveRunning ? undefined : runLive}
                  aria-disabled={blockedReason || liveRunning ? true : undefined}
                  className="btn-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-md px-5 text-[15px] font-semibold sm:h-11 sm:w-auto sm:min-w-[150px]"
                >
                  <PlayIcon size={18} weight="fill" aria-hidden />
                  {runButtonLabel}
                </button>
                {liveRunning ? (
                  <button type="button" onClick={stop} className="link shrink-0 text-[14px] font-medium">
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
            {blockedReason ? <p className="mt-2 text-[13px] text-ink-muted">{blockedReason}</p> : null}
            {anyLiveRunning ? <p className="mt-2 text-[13px] text-ink-muted">Locked while this run is going.</p> : null}
            {banner ? (
              <p className="fade-in mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]">
                <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{banner.text}</span>
              </p>
            ) : preview?.busy ? (
              <p className="fade-in mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]">
                <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>A live run is already going. Live runs go one at a time; try again in a few minutes, or use the recorded run.</span>
              </p>
            ) : null}
            {liveHere?.phase === "error" && liveHere.error ? (
              <p className="fade-in mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]">
                <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{liveHere.error}</span>
              </p>
            ) : null}
            <p className="mt-3 text-[12px] text-ink-muted sm:text-[13px]">
              {runLabelLead ? <span className="font-semibold text-ink">{runLabelLead}</span> : null}
              {runLabelRest}
            </p>
            <p className="mt-1 max-w-[80ch] text-[13px] text-ink-muted">{provenanceLine}</p>
          </div>

          {/* tally */}
          <div className="order-3 lg:order-none">
            {run && (attempts.length > 0 || running) ? (
              <>
                <Tally
                  run={run}
                  selected={selIdx}
                  onSelect={(i) => setSelected(i)}
                  pending={running ? { stepIndex } : null}
                  stopped={stopped}
                />
                {attempt ? (
                  <p
                    className={`mt-2 text-[14px] font-semibold sm:hidden ${
                      attempt.outcome === "certified" ? "text-success" : attempt.outcome.startsWith("held") ? "text-hold" : ""
                    }`}
                  >
                    Try {attempt.n}: {outcomeText(attempt, run, attempts[selIdx - 1])}
                  </p>
                ) : null}
              </>
            ) : liveHere?.phase === "starting" ? (
              <div data-region="tally" className="py-6" aria-live="polite">
                <p className="shimmer text-[15px]">Starting a live run: waking the CreateOS sandbox…</p>
              </div>
            ) : ready ? (
              <div data-region="tally" className="rounded-md py-6">
                <p className="text-[15px]">Nothing has run on this invoice yet. Press Run live to start; a run takes a few minutes.</p>
                {replay && (previewState || liveHere) ? (
                  <button type="button" className="link mt-2 text-[14px] font-medium" onClick={resetAll}>
                    See the recorded run
                  </button>
                ) : null}
              </div>
            ) : (
              <div data-region="tally" className="h-[184px]" aria-busy="true" />
            )}
          </div>

          {/* detail */}
          <div id="attempt-detail" role="tabpanel" className="order-5 min-w-0 lg:order-none">
            {showChecklist ? (
              <div className="grid gap-6 xl:grid-cols-8">
                <div className="min-w-0 xl:col-span-5">
                  <Checklist run={run} stepIndex={stepIndex} elapsedMs={stepElapsed} />
                </div>
                <div className="min-w-0 xl:col-span-3">
                  {attempt && run ? <RulesList key={`${run.runId}-${attempt.n}`} run={run} attempt={attempt} running /> : null}
                </div>
              </div>
            ) : attempt && run ? (
              <div className="grid gap-6 xl:grid-cols-8" key={`${run.runId}-${previewState}-${attempt.n}`}>
                <div className="fade-in min-w-0 xl:col-span-5">
                  <button
                    type="button"
                    aria-expanded={phoneChange}
                    onClick={() => setPhoneChange(!phoneChange)}
                    className="btn-tonal h-11 w-full rounded-md px-3 text-[14px] font-semibold lg:hidden"
                  >
                    {phoneChange ? "Hide the code change" : `Show what the AI changed (try ${attempt.n})`}
                  </button>
                  <div className={phoneChange ? "mt-4 lg:mt-0" : "hidden lg:block"}>
                    <ChangePane run={run} attempt={attempt} />
                  </div>
                </div>
                <div className="fade-in min-w-0 xl:col-span-3">
                  <RulesList run={run} attempt={attempt} running={false} />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* right block */}
        <div className="contents lg:col-span-5 lg:flex lg:min-w-0 lg:flex-col lg:gap-6 xl:col-span-4">
          <div className="order-4 min-w-0 lg:order-none" key={`${source}-${previewState}-${selIdx}-${fool.result?.mutation ?? ""}`}>
            <Sheet
              run={run}
              attempt={attempt}
              sourceLabel={run?.source.label ?? sourceLabel(source)}
              checking={running}
              stopped={stopped}
              validatorDown={validatorDown}
              fool={fool}
              canFool={!running && !!run && run.attempts.some((a) => a.outcome === "certified")}
              foolBlocked={source === "stripe" ? {} : { discount: "This invoice has no document-level discount to drop." }}
              convertBlocked={
                source === "cii"
                  ? "Converting another invoice with the AI off isn't available here: we have only one official CEN example invoice."
                  : null
              }
              onFool={doFool}
              onFoolBack={() => setFool((f) => ({ ...f, result: null }))}
              convert={convert}
              onConvert={doConvert}
              onConvertXml={downloadConvertXml}
              onXml={downloadXml}
              onCert={downloadCert}
            />
          </div>
        </div>
      </main>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <CreateOSPanel run={run ?? replay} health={health} />
        <StripePanel run={run ?? replay} />
      </div>

      <AboutCard />
      <Footer recordedAt={replay?.recordedAt} />
    </div>
  );
}
