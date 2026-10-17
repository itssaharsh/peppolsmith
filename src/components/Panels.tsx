"use client";

import { CopyIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
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
        Where the AI&apos;s code runs (CreateOS)
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
        <Row label="Network">Off while the AI&apos;s code runs. One deny-by-default egress rule, set on the host, outside the VM.</Row>
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
        How the stack was set up (Stripe Projects)
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
        <Row label="AI model">
          {m.name}, through {m.provider}. Falls back to DeepSeek-V3.2 on Featherless, then free OpenRouter models.
        </Row>
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
          Download an example invoice under the upload box, upload it and press Convert it. The AI writes, runs and fixes a converter in front of
          you, usually in 20 to 90 seconds per try.
        </li>
        <li>
          {first !== null && attempts > 1
            ? `Or watch a recorded example run: the EU checker's errors fall from ${first} to 0. Click any try to see the errors and the AI's code change.`
            : "Or watch a recorded example run, and click any try to see the errors and the AI's code change."}
        </li>
        <li>In the recorded Stripe example, open Try to fool the checks and press Drop the discount: every EU rule passes, and Peppolsmith holds it back.</li>
        <li>Press Convert another invoice, AI off: the approved converter runs again with 0 AI calls.</li>
        <li>Download the e-invoice and check it in any public Peppol validator.</li>
      </ol>
    </div>
  );
}

export function AboutCard() {
  return (
    <section id="about" className="mx-auto mt-14 max-w-[1080px] scroll-mt-6 rounded-lg border border-line bg-surface-1 px-5 py-6 sm:px-8" aria-labelledby="about-h">
      <p className="text-[14px] text-ink-muted">
        The official EU checker only checks that an invoice agrees with itself. Peppolsmith also checks that it agrees with what you billed.
      </p>
      <h2 id="about-h" className="mt-2 font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em]">
        New to e-invoices? Read what Peppolsmith does, in plain words.
      </h2>
      <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-medium">
        <Link href="/about" className="link">
          About Peppolsmith
        </Link>
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
