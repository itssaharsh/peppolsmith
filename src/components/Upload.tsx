"use client";

import { FileArrowUpIcon, PlayIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { SOURCES, type SourceKey } from "@/lib/client/format";

const MAX_BYTES = 100 * 1024;
const MAX_PDF_BYTES = 2_000_000;

export type Detected = { kind: SourceKey; label: string } | null;

/** Display-only detection; the server decides for real. */
export function detectKind(text: string): Detected {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as { object?: unknown };
      if (j && j.object === "invoice") return { kind: "stripe", label: "Stripe invoice (JSON)" };
    } catch {
      return null;
    }
    return null;
  }
  if (t.startsWith("<") && t.includes("CrossIndustryInvoice")) return { kind: "cii", label: "CII e-invoice (UN/CEFACT XML)" };
  const header = t.split(/\r?\n/, 1)[0] ?? "";
  if (header.includes(";") && /invoice_no/i.test(header)) return { kind: "csv", label: "Billing export (CSV)" };
  return null;
}

const EXAMPLES = [
  { href: "/examples/invoice.pdf", label: "Invoice (PDF)" },
  { href: "/examples/stripe-invoice.json", label: "Stripe invoice (JSON)" },
  { href: "/examples/billing-export.csv", label: "Billing export (CSV)" },
  { href: "/examples/cii-invoice.xml", label: "CII e-invoice (XML)" },
];

type Props = {
  starting: boolean;
  error: string | null;
  blockedReason: string | null;
  onConvert: (text: string, fileName: string, pdf?: string) => void;
  onExample: (k: SourceKey) => void;
};

export function Upload({ starting, error, blockedReason, onConvert, onExample }: Props) {
  const [file, setFile] = useState<{ name: string; text: string; size: number; pdf?: string } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = (f: File | undefined | null) => {
    setReadError(null);
    if (!f) return;
    if (/\.pdf$/i.test(f.name)) {
      if (f.size > MAX_PDF_BYTES) {
        setFile(null);
        setReadError(`${f.name} is ${(f.size / 1_000_000).toFixed(1)} MB. The limit for PDFs is 2 MB.`);
        return;
      }
      const pdfReader = new FileReader();
      pdfReader.onload = () => {
        const bytes = new Uint8Array(pdfReader.result as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        setFile({ name: f.name, text: "", size: f.size, pdf: btoa(bin) });
      };
      pdfReader.onerror = () => setReadError(`Couldn't read ${f.name}.`);
      pdfReader.readAsArrayBuffer(f);
      return;
    }
    if (!/\.(json|csv|xml)$/i.test(f.name)) {
      setFile(null);
      setReadError(
        /\.(png|jpe?g|heic|docx?)$/i.test(f.name)
          ? `${f.name} is a photo or a document file. Upload the invoice as a PDF with selectable text, or the data export from your billing tool.`
          : `${f.name} isn't a PDF, .json, .csv or .xml file.`,
      );
      return;
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setReadError(`${f.name} is ${Math.ceil(f.size / 1024)} KB. The limit is 100 KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, text: String(reader.result ?? ""), size: f.size });
    reader.onerror = () => setReadError(`Couldn't read ${f.name}.`);
    reader.readAsText(f);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  const text = paste ? pasted : (file?.text ?? "");
  const name = paste ? "pasted-invoice" : (file?.name ?? "");
  const tooBig = paste && new Blob([pasted]).size > MAX_BYTES;
  const isPdf = !paste && !!file?.pdf;
  const detected: Detected = isPdf ? { kind: "csv", label: "PDF invoice: the AI reads it, then checks with no AI verify every number it read" } : detectKind(text);
  const hasInput = paste ? pasted.trim().length > 0 : !!file;
  const canConvert = hasInput && !!detected && !tooBig && !starting && !blockedReason;

  return (
    <section aria-labelledby="upload-h" className="mx-auto mt-6 max-w-[880px] lg:mt-10" data-region="upload">
      <div className="rounded-lg border border-line bg-surface-1 px-5 py-6 sm:px-8 sm:py-8">
        <h1 id="upload-h" className="font-display font-extrabold leading-[1.1] tracking-[-0.02em]" style={{ fontSize: "var(--text-landing)" }}>
          Turn your invoices into EU e-invoices.
        </h1>
        <p className="mt-3 max-w-[68ch] text-[15px] leading-6 sm:text-[16px]">
          Upload an invoice: a PDF, or the data your billing tool exports. An AI writes a converter for it, runs it in a locked sandbox, and
          fixes it until the official EU checker finds 0 errors. You get a Peppol e-invoice, released only if its totals match your invoice.
        </p>

        {!paste ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`mt-6 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 sm:py-10 ${
              over ? "border-ink bg-surface-2" : "border-line-input/60 bg-canvas"
            }`}
          >
            <FileArrowUpIcon size={36} className="text-ink-muted" aria-hidden />
            <p className="text-[15px] font-semibold">Drop an invoice here</p>
            <p className="text-[13px] text-ink-muted">A PDF (up to 2 MB), a Stripe invoice (.json), a billing CSV export (.csv) or a CII e-invoice (.xml)</p>
            <p className="max-w-[56ch] text-[12px] text-ink-muted">For a PDF, the AI reads it first; then every amount, the invoice number and the VAT numbers it read are checked against the PDF with no AI.</p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.json,.csv,.xml,application/pdf,application/json,text/csv,text/xml,application/xml"
              className="sr-only"
              aria-label="Choose an invoice file"
              onChange={(e) => {
                take(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-tonal mt-1 inline-flex h-11 items-center gap-2 rounded-md px-5 text-[15px] font-semibold"
            >
              Choose a file
            </button>
          </div>
        ) : (
          <label className="mt-6 block">
            <span className="mb-1 block text-[13px] font-semibold text-ink-muted">Paste the invoice text (JSON, CSV or XML)</span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-md border border-line-input bg-surface-1 p-3 font-mono text-[13px] leading-5"
            />
          </label>
        )}
        <button
          type="button"
          className="link mt-2 text-[13px] font-medium text-ink-muted"
          onClick={() => {
            setPaste(!paste);
            setReadError(null);
          }}
        >
          {paste ? "Upload a file instead" : "Paste instead"}
        </button>

        {readError ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]" role="alert">
            <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            {readError}
          </p>
        ) : null}

        {hasInput ? (
          <div className="rise-in mt-4 flex flex-col gap-3 rounded-md bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[14px]">
              {!paste ? <p className="truncate font-mono text-[13px]">{name}</p> : null}
              {tooBig ? (
                <p>The pasted text is over 100 KB.</p>
              ) : detected ? (
                <p>
                  Detected: <span className="font-semibold">{detected.label}</span>
                </p>
              ) : (
                <p>This doesn&apos;t look like a Stripe invoice JSON, a CII XML or our CSV layout.</p>
              )}
            </div>
            <button
              type="button"
              aria-disabled={canConvert ? undefined : true}
              onClick={canConvert ? () => onConvert(text, name, isPdf ? file?.pdf : undefined) : undefined}
              className="btn-primary inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-md px-6 text-[16px] font-semibold"
            >
              <PlayIcon size={18} weight="fill" aria-hidden />
              {starting ? (isPdf ? "Reading your PDF…" : "Starting…") : "Convert it"}
            </button>
          </div>
        ) : null}
        {blockedReason && hasInput ? <p className="mt-2 text-[13px] text-ink-muted">{blockedReason}</p> : null}
        {error ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[14px]" role="alert">
            <WarningIcon size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}

        <div className="mt-6 border-t border-line pt-4 text-[14px]">
          <p>No invoice handy? Download one of these and upload it:</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {EXAMPLES.map((e) => (
              <li key={e.href}>
                <a href={e.href} download className="link font-medium">
                  {e.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-ink-muted">
            Peppol IDs and seller details that an invoice doesn&apos;t carry come from declared settings for each format.{" "}
            <Link href="/about#settings" className="link">
              See them
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 px-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <span className="text-[14px] font-semibold">Or watch a recorded example run:</span>
        <span className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onExample(s.key)}
              className="btn-tonal h-9 rounded-md px-3 text-[13px] font-semibold"
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>
    </section>
  );
}
