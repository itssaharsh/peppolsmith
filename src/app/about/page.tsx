import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
import { MiniRing, Ring, Tick } from "@/components/glyphs";
import { GITHUB_URL } from "@/lib/client/format";
import partners from "../../../config/trading-partners.json";

type Flat = [string, string][];
function flatten(v: unknown, prefix = ""): Flat {
  if (v === null || v === undefined) return [];
  if (typeof v !== "object") return [[prefix, String(v)]];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix} ${k}` : k));
}
const KIND_LABEL: Record<string, string> = {
  stripe: "Stripe invoices (JSON)",
  cii: "CII e-invoices (XML)",
  csv: "Billing exports (CSV)",
};
const pretty = (k: string) => {
  const t = k.replace(/_/g, " ").replace(/\bvat\b/i, "VAT").replace(/\biban\b/i, "IBAN").replace(/\bid\b/, "ID");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const metadata: Metadata = {
  title: "About Peppolsmith: EU e-invoices from the billing data you already have",
  description:
    "What Peppolsmith is, in plain words: an AI writes a converter from your billing tool's invoices to Peppol e-invoices, and nothing is released until three checks pass.",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-14 scroll-mt-6">
      <h2 id={`${id}-h`} className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[26px]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const STEPS = [
  {
    title: "You give it an invoice",
    body: "One invoice as you already have it: a PDF, a Stripe invoice, a spreadsheet export or a CII e-invoice. For a PDF, every number the AI reads is checked against the PDF with no AI.",
  },
  {
    title: "An AI writes a converter",
    body: "The AI writes a small program, map.py, that turns that kind of invoice into a Peppol e-invoice.",
  },
  {
    title: "It runs locked, and fixes itself",
    body: "The program runs in a locked CreateOS sandbox with no internet. The official EU checker lists every error; the AI reads them and fixes its own code, up to 8 tries.",
  },
  {
    title: "Released only if 3 checks pass",
    body: "The EU rules, the totals and the company IDs. If any check fails, nothing is released, and the page says exactly why.",
  },
];

const CHECKS = [
  {
    name: "Follows the official EU e-invoice rules",
    body: "The CEN EN16931 rules and the Peppol BIS Billing 3.0 rules, run by the official checker inside the sandbox.",
  },
  {
    name: "The totals match the original bill",
    body: "Lines, net total, VAT per rate and amount due must equal what the customer was actually billed. No AI is involved in this check.",
  },
  {
    name: "Every company ID comes from the original invoice",
    body: "Every company name, VAT number, Peppol ID and bank account must appear in the original invoice or the declared settings. Nothing invented. No AI is involved in this check.",
  },
];

const RESULTS = [
  {
    source: "Official CEN example invoice (CII format)",
    tries: "6, 5, no invoice (crash), 1, then 0: approved",
    calls: "5",
    cost: "$0.030",
    time: "66 s",
  },
  { source: "Stripe test-mode invoice", tries: "Broken XML, 2, then 0: approved", calls: "3", cost: "$0.022", time: "54 s" },
  {
    source: "Billing-app spreadsheet export (CSV, European decimals, two VAT rates)",
    tries: "0 on the first try: approved",
    calls: "1",
    cost: "$0.005",
    time: "17 s",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 lg:px-8">
      <TopBar page="about" />
      <main className="mx-auto max-w-[920px] pb-16 pt-8 lg:pt-12">
        <p className="text-[14px] font-semibold text-ink-muted">About Peppolsmith</p>
        <h1 className="mt-2 font-display font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: "var(--text-landing)" }}>
          EU e-invoices from the billing data you already have
        </h1>
        <p className="mt-5 max-w-[66ch] text-[16px] leading-6 sm:text-[18px] sm:leading-7">
          Peppolsmith turns the invoices your billing tool already produces into Peppol e-invoices, the structured format businesses in Belgium now
          have to use. An AI writes the converter and fixes it until the official EU checker finds no errors. Then two more checks, which the AI
          can&apos;t touch, make sure the e-invoice still says what you actually billed. Only then is anything released.
        </p>
        <p className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="btn-primary inline-flex h-11 items-center rounded-md px-5 text-[15px] font-semibold">
            Try it
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-tonal inline-flex h-11 items-center rounded-md px-5 text-[15px] font-semibold"
          >
            Source on GitHub
          </a>
        </p>

        <Section id="problem" title="The problem">
          <div className="max-w-[66ch] space-y-3 text-[16px] leading-7">
            <p>
              Since 1 January 2026, Belgian businesses must send each other structured e-invoices over the Peppol network: a precise XML format that
              software can read, instead of a PDF.
            </p>
            <p>
              Most small billing tools don&apos;t produce that. They export PDFs, spreadsheets (CSV) or their own data format (JSON). Someone has to
              write a converter, and a converter that is slightly wrong sends wrong invoices.
            </p>
          </div>
        </Section>

        <Section id="how" title="How it works">
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col rounded-lg border border-line bg-surface-1 p-4">
                <span className="font-display text-[40px] font-extrabold leading-none tnum">{i + 1}</span>
                <span className="mt-3 text-[16px] font-bold leading-snug">{s.title}</span>
                <span className="mt-1.5 text-[14px] leading-5 text-ink-muted">{s.body}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="checks" title="The three checks">
          <ul className="space-y-4">
            {CHECKS.map((c) => (
              <li key={c.name} className="flex gap-3">
                <Tick size={22} className="mt-0.5" />
                <span>
                  <span className="block text-[17px] font-bold">{c.name}</span>
                  <span className="mt-0.5 block max-w-[64ch] text-[15px] leading-6 text-ink-muted">{c.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="why" title="Why the extra two checks matter">
          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)] lg:items-start">
            <div className="max-w-[60ch] space-y-3 text-[16px] leading-7">
              <p>The official checker only checks that an invoice agrees with itself. It can&apos;t know what you actually billed.</p>
              <p>
                An example from our tests: we take an approved e-invoice and drop its 10% discount, keeping every number consistent. Every official
                rule still passes. But the customer would be charged €614.68 instead of €553.21.
              </p>
              <p>Peppolsmith compares the e-invoice with the original bill, sees the difference, and holds it back.</p>
            </div>
            <div className="rounded-lg border border-line bg-surface-1 p-5">
              <p className="text-[13px] font-semibold text-ink-muted">The discount dropped</p>
              <dl className="mt-3 space-y-2.5 text-[15px]">
                <div className="flex items-center justify-between gap-3">
                  <dt>Official EU rules</dt>
                  <dd className="inline-flex items-center gap-1.5 font-semibold text-success">
                    <Tick size={16} /> 0 errors
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>The bill says</dt>
                  <dd className="font-bold tnum">€553.21</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>The e-invoice says</dt>
                  <dd className="font-bold tnum">
                    <span className="relative inline-block">
                      €614.68
                      <Ring scale={1.3} width={2.5} delay={300} />
                    </span>
                  </dd>
                </div>
              </dl>
              <p className="mt-4 flex items-center gap-2 rounded-md bg-hold-container px-3 py-2 text-[15px] font-bold text-hold">
                <MiniRing /> Held back
              </p>
            </div>
          </div>
        </Section>

        <Section id="get" title="What you get">
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              ["The e-invoice", "The Peppol XML file, ready for your Peppol access point."],
              ["A certificate", "Which rules ran (with their versions and file hashes), the totals compared, the IDs traced, and which AI and sandbox were used."],
              ["A reusable converter", "The approved converter turns the next invoice of the same kind in about 1.7 seconds, with no AI call."],
            ].map(([t, b]) => (
              <li key={t} className="rounded-lg border border-line bg-surface-1 p-4">
                <span className="block text-[16px] font-bold">{t}</span>
                <span className="mt-1 block text-[14px] leading-5 text-ink-muted">{b}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="results" title="Results from our recorded runs (17 Oct 2026)">
          <div className="overflow-x-auto rounded-lg border border-line bg-surface-1">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px] tnum">
              <thead>
                <tr className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  <th className="px-4 py-2.5 font-semibold">Invoice</th>
                  <th className="px-4 py-2.5 font-semibold">EU checker errors, per try</th>
                  <th className="px-4 py-2.5 text-right font-semibold">AI calls</th>
                  <th className="px-4 py-2.5 text-right font-semibold">AI cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Time</th>
                </tr>
              </thead>
              <tbody>
                {RESULTS.map((r) => (
                  <tr key={r.source} className="border-t border-line align-top">
                    <td className="px-4 py-2.5">{r.source}</td>
                    <td className="px-4 py-2.5">{r.tries}</td>
                    <td className="px-4 py-2.5 text-right">{r.calls}</td>
                    <td className="px-4 py-2.5 text-right">{r.cost}</td>
                    <td className="px-4 py-2.5 text-right">{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-5 max-w-[70ch] list-disc space-y-2 pl-5 text-[15px] leading-6">
            <li>
              <span className="font-semibold">Trying to fool the checks.</span> We planted three converter bugs into an approved e-invoice: amounts in
              cents treated as euros, a dropped discount, and an invented buyer Peppol ID with a valid checksum. Each one passes every official rule,
              and each one is held back by the totals check or the ID check. The home page runs these live.
            </li>
            <li>
              <span className="font-semibold">Converting with the AI off.</span> The approved converters ran on a second Stripe test invoice and a
              second spreadsheet export. Both were approved in about 1.7 s with 0 AI calls.
            </li>
            <li>
              <span className="font-semibold">Honest limits of the evidence.</span> Across our 21 test runs, all 14 e-invoices that passed the
              official rules also matched their original, so the extra checks never caught a real AI slip. The planted bugs are the evidence that they
              would. Results also vary from run to run: the CEN example reached approval within 6 tries in 6 of 8 runs, the Stripe invoice in 6 of
              7, the spreadsheet export in 1 of 1. Nothing was ever released without all three checks passing.
            </li>
          </ul>
        </Section>

        <Section id="settings" title="Declared settings">
          <p className="max-w-[66ch] text-[15px] leading-6">
            An invoice doesn&apos;t always carry everything a Peppol e-invoice needs, such as the Peppol IDs of seller and buyer. Those values come from
            declared settings for each format, and the ID check accepts them alongside the invoice itself. All of them are fictional, in valid formats.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {Object.entries(partners as Record<string, unknown>)
              .filter(([k]) => k in KIND_LABEL)
              .map(([k, v]) => (
                <div key={k} className="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
                  <h3 className="text-[15px] font-bold">{KIND_LABEL[k]}</h3>
                  <dl className="mt-2 space-y-1 text-[13px]">
                    {flatten(v).map(([key, val]) => (
                      <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
                        <dt className="text-ink-muted">{pretty(key)}</dt>
                        <dd className="break-words font-mono text-[12px]">{val}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
          </div>
        </Section>

        <Section id="built" title="Built with">
          <ul className="grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-2">
            <li>
              <span className="font-semibold">CreateOS Sandbox:</span> the locked VM where the AI&apos;s code and the EU checker run, with the
              network off.
            </li>
            <li>
              <span className="font-semibold">Stripe Projects:</span> set up the whole stack from the Stripe CLI, including the AI model&apos;s key.
            </li>
            <li>
              <span className="font-semibold">Qwen3-Coder 480B, through Featherless:</span> the AI that writes and fixes the converter.
            </li>
            <li>
              <span className="font-semibold">Vercel and Next.js:</span> host and build this site.
            </li>
          </ul>
        </Section>

        <Section id="limits" title="Limits">
          <ul className="max-w-[70ch] list-disc space-y-2 pl-5 text-[15px] leading-6 text-ink-muted">
            <li>Passing the CEN and Peppol rules is not delivery over the Peppol network, which needs an access point.</li>
            <li>
              The sample invoices are labelled in the app: one official CEN example (unmodified), Stripe test-mode invoices we created, and CSV rows we
              wrote. Seller and buyer IDs are fictional; the CEN example&apos;s seller contact is our declared setting, because the example leaves it
              empty and Peppol&apos;s German rules require one.
            </li>
            <li>Live runs are limited to one at a time and 60 a day, so the public site can&apos;t run up the AI bill.</li>
          </ul>
        </Section>

        <p className="mt-14 flex flex-wrap gap-3">
          <Link href="/" className="btn-primary inline-flex h-11 items-center rounded-md px-5 text-[15px] font-semibold">
            Try it
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-tonal inline-flex h-11 items-center rounded-md px-5 text-[15px] font-semibold"
          >
            Source on GitHub
          </a>
        </p>
      </main>
      <footer className="border-t border-line py-6 text-[13px] text-ink-muted">
        <p>
          Every line of code was written after the build window opened on 17 Oct 2026 at 12:00 PM PDT. Seller and buyer IDs in the samples are
          fictional.
        </p>
      </footer>
    </div>
  );
}
