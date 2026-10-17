"use client";

import { CopyIcon } from "@phosphor-icons/react/dist/ssr";
import { useState, type ReactNode } from "react";
import type { RunLog } from "@/lib/runlog";
import { GITHUB_URL, pdt, pdtTime, runModel, secs, usd } from "@/lib/client/format";

export type Health = { vmId: string; vmStatus: string; busy: boolean; runsToday: number; dailyCap: number; checkedAt: string };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-t border-line/70 py-2 first:border-t-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-[14px]">{children}</dd>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
      className="ml-1.5 inline-flex items-center gap-1 align-middle text-[12px] text-ink-muted hover:text-ink"
      aria-label={`Copy ${text}`}
    >
      <CopyIcon size={16} aria-hidden />
      {done ? "Copied" : ""}
    </button>
  );
}

export function CreateOSPanel({ run, health }: { run: RunLog | null; health: Health | null }) {
  const sb = run?.sandbox;
  const blocked = sb?.blocked ?? [];
  return (
    <section className="rounded-lg border border-line bg-surface-1 px-5 py-5 sm:px-6" aria-labelledby="createos-h">
      <h2 id="createos-h" className="text-[15px] font-bold">
        CreateOS Sandbox: where the model&apos;s code runs
      </h2>
      <dl className="mt-3">
        <Row label="VM">
          {sb ? (
            <>
              <span className="break-all font-mono text-[13px]">{sb.vmId}</span>
              <Copy text={sb.vmId} />
              <span className="block text-[13px] text-ink-muted">
                Image <span className="font-mono">{sb.image}</span>, shape <span className="font-mono">{sb.shape}</span>, {sb.plan} plan
                {health ? `. Now ${health.vmStatus}, checked ${pdtTime(health.checkedAt)}` : ""}
                {health ? "" : run ? " (as recorded)" : ""}.
              </span>
            </>
          ) : (
            <span className="text-ink-muted">No run loaded.</span>
          )}
        </Row>
        <Row label="Network">Off while the model&apos;s code runs. One deny-by-default egress rule, set on the host, outside the VM.</Row>
        <Row label="Blocked">
          {blocked.length
            ? `${blocked.length} ${blocked.length === 1 ? "connection" : "connections"} this run: ${blocked
                .map((b) => `${b.host}, attempt ${b.attempt}${b.by === "probe" ? " (test probe)" : ""}`)
                .join("; ")}`
            : "None this run"}
        </Row>
        {sb?.resumeMs != null ? (
          <Row label="Warm start">Resumed the paused VM in {secs(sb.resumeMs)}. The validator was already installed.</Row>
        ) : null}
        <Row label="Fork">
          {sb?.forkedFrom ? (
            <>
              This run&apos;s VM is a fork of the paused base VM <span className="font-mono text-[13px]">{sb.forkedFrom}</span>.
            </>
          ) : (
            "Not used: the Free plan allows one sandbox, so every run resumes the same paused VM."
          )}
        </Row>
        {sb?.liveUrl ? (
          <Row label="Live URL">
            <a href={sb.liveUrl} className="link break-all font-mono text-[13px]" target="_blank" rel="noreferrer">
              {sb.liveUrl}
            </a>
            <Copy text={sb.liveUrl} />
            <span className="block text-[13px] text-ink-muted">Serves the certified converter: send a source record, get Peppol XML back. No model.</span>
          </Row>
        ) : null}
      </dl>
    </section>
  );
}

export function StripePanel({ run }: { run: RunLog | null }) {
  const m = runModel(run);
  const rows: [string, ReactNode][] = [
    ["createos/project", "Free plan. Runs the model's code in the sandbox VM."],
    ["openrouter/api", "Free plan. The fallback model route."],
    ["vercel/project", "Hobby plan. Hosts this page."],
    [
      "featherless-api-key",
      <>
        A Stripe Projects variable, read as <span className="font-mono text-[13px]">FEATHERLESS_API_KEY</span>: the key for the primary model, {m.name}{" "}
        through {m.provider}.
      </>,
    ],
  ];
  return (
    <section className="rounded-lg border border-line bg-surface-1 px-5 py-5 sm:px-6" aria-labelledby="stripe-h">
      <h2 id="stripe-h" className="text-[15px] font-bold">
        Stripe Projects: how this stack was set up
      </h2>
      <p className="mt-1 text-[14px]">
        Provisioned from the Stripe CLI with <span className="font-mono text-[13px]">stripe projects add</span>:
      </p>
      <dl className="mt-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-t border-line/70 py-2 first:border-t-0 sm:grid-cols-[170px_minmax(0,1fr)]">
            <dt className="font-mono text-[13px]">{k}</dt>
            <dd className="min-w-0 text-[14px]">{v}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-2 border-t border-line pt-1">
        <Row label="Invoice source">The Stripe test invoice was created with the Stripe CLI in test mode.</Row>
        {run ? (
          <Row label="Model cost">
            <span className="tnum">
              {usd(run.model.costUsd)} for this run, {run.model.calls} model {run.model.calls === 1 ? "call" : "calls"}
              {run.model.fallbackUsed ? ", fallback model used" : ""}.
            </span>
          </Row>
        ) : null}
      </dl>
    </section>
  );
}

export function JudgePopover({ first, attempts }: { first: number | null; attempts: number }) {
  return (
    <div id="judge" popover="auto" className="judge">
      <h2 className="text-[15px] font-bold">How to judge this in 90 seconds</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14px]">
        <li>
          {first !== null && attempts > 1
            ? `Read the attempts: failed official rules fall from ${first} to 0. Click any attempt to see its rules and the model's code change.`
            : "Read the attempts: each column is one try at map.py and the official rules it failed. Click an attempt to see its rules and the model's code."}
        </li>
        <li>Open Try to fool the gates and press Drop the discount: the official rules pass, and Peppolsmith holds it.</li>
        <li>Press Convert a new invoice with the model off: the certified converter runs again with 0 model calls.</li>
        <li>Press Run live to watch the agent write, run and fix its code (a few minutes).</li>
        <li>Download the XML and check it in any public Peppol validator.</li>
      </ol>
    </div>
  );
}

export function About({ run }: { run: RunLog | null }) {
  const proofs: { fig: string; line: string }[] = [];
  if (run && run.verdict === "certified" && run.attempts.length > 1) {
    const firstWithRules = run.attempts.find((a) => a.rules);
    const first = firstWithRules?.rules?.failed.length;
    if (first && first > 0)
      proofs.push({
        fig: `${first} to 0`,
        line: `Failed official rules over ${run.attempts.length} attempts on the ${run.source.kind === "cii" ? "official CEN example invoice" : run.source.kind === "stripe" ? "Stripe test-mode invoice" : "CSV export"}, each fix shown as a code change.`,
      });
  }
  if (run && run.verdict === "certified") {
    const last = run.attempts[run.attempts.length - 1];
    if (last?.provenance)
      proofs.push({
        fig: `${last.provenance.traced} of ${last.provenance.total}`,
        line: "Party IDs in the certified XML traced back to the source or the declared settings, by a check the model can't edit.",
      });
    proofs.push({
      fig: usd(run.model.costUsd),
      line: `Model cost of the recorded run, from source to certified XML, in ${run.attempts.length} ${run.attempts.length === 1 ? "attempt" : "attempts"}.`,
    });
  }
  return (
    <section id="about" className="mx-auto max-w-[1080px] scroll-mt-6 py-16" aria-labelledby="about-h">
      <p className="max-w-[64ch] text-[15px] text-ink-muted">
        The official validator checks that an invoice agrees with itself. Peppolsmith also checks that it agrees with what you billed.
      </p>
      <h2 id="about-h" className="mt-3 font-display font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: "var(--text-landing)" }}>
        Peppol e-invoices from the billing data you already have
      </h2>
      <p className="mt-4 max-w-[64ch] text-[18px] leading-7">
        An agent writes a converter for your invoice data and fixes it inside a locked CreateOS sandbox until the official EU rules pass and every
        total matches what you billed.
      </p>
      {proofs.length ? (
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {proofs.map((p) => (
            <div key={p.fig}>
              <p className="text-[32px] font-extrabold leading-none tnum">{p.fig}</p>
              <p className="mt-2 text-[15px]">{p.line}</p>
            </div>
          ))}
        </div>
      ) : null}
      <h3 className="mt-12 text-[15px] font-bold">How it works</h3>
      <ol className="mt-3 grid gap-4 text-[16px] sm:grid-cols-3">
        {[
          "Pick a source: a Stripe test invoice, an official CEN example or a CSV export.",
          "The agent writes map.py, runs it in a CreateOS VM with the network off, reads which official rules fail and fixes its code.",
          "Release needs three checks: the official rules, totals tied to the source, and every ID traced back to it.",
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-extrabold tnum">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <div className="mt-10 space-y-2 text-[15px] text-ink-muted">
        <p>Passing the CEN and Peppol rules is not delivery over the Peppol network, which needs an access point.</p>
        <p>
          The samples are labelled: one official CEN example, one Stripe test-mode invoice we created, and CSV rows we wrote in a home-grown billing
          export layout. Seller and buyer IDs are fictional.
        </p>
      </div>
      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-medium">
        <a href="#top" className="link">
          Try it live
        </a>
        <a href={GITHUB_URL} className="link" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </section>
  );
}

export function Footer({ recordedAt }: { recordedAt?: string }) {
  return (
    <footer className="border-t border-line py-6 text-[13px] text-ink-muted">
      <p>
        Samples: an official CEN example (unmodified), a Stripe test-mode invoice we created, and CSV rows we wrote in a home-grown billing export
        layout. Seller and buyer IDs are fictional.
      </p>
      <p className="mt-1">
        Planning came before the build window; every line of code was written after it opened on 17 Oct 2026 at 12:00 PM PDT.
        {recordedAt ? ` The recorded run on this page is from ${pdt(recordedAt)}.` : ""}
      </p>
      <p className="mt-2">
        <a href={GITHUB_URL} className="link" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </footer>
  );
}
