// Client-only formatting helpers. No server imports.
import type { Attempt, RunLog } from "@/lib/runlog";
import type { ReconRow } from "@/lib/gates";

export const GITHUB_URL = "https://github.com/itssaharsh/peppolsmith";

export type SourceKey = "stripe" | "cii" | "csv";
export const SOURCES: { key: SourceKey; label: string; provenance: string }[] = [
  {
    key: "stripe",
    label: "Stripe test invoice",
    provenance: "A Stripe test-mode invoice created with the Stripe CLI: Stripe's own invoice format, with a customer and amounts we wrote.",
  },
  {
    key: "cii",
    label: "CEN example (CII)",
    provenance: "An official example invoice from the CEN EN16931 test set, in the UN/CEFACT CII format. Unmodified.",
  },
  {
    key: "csv",
    label: "CSV export",
    provenance: "Invoice rows we wrote in a home-grown billing app's CSV export: semicolons, comma decimals, two VAT rates.",
  },
];
export const isSource = (s: unknown): s is SourceKey => s === "stripe" || s === "cii" || s === "csv";
export const sourceLabel = (k: SourceKey) => SOURCES.find((s) => s.key === k)?.label ?? k;

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
export const money = (cents: number) => eur.format(cents / 100);
export const usd = (v: number) => {
  if (v === 0) return "$0.00";
  if (v < 1) return "$" + v.toFixed(4);
  return "$" + v.toFixed(2);
};

export function reconValue(row: ReconRow, which: "source" | "xml"): string {
  const v = row[which];
  if (v === null || v === undefined) return "n/a";
  return row.unit === "money" ? money(v) : String(v);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
/** "17 Oct 2026, 12:43 PM PDT" */
export function pdt(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dateFmt.format(d)}, ${timeFmt.format(d)} PDT`;
}
export function pdtTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${timeFmt.format(d)} PDT`;
}

export const secs = (raw: number) => {
  const ms = Math.max(0, raw);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
};
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "Qwen/Qwen3-Coder-480B-A35B-Instruct" -> "Qwen3-Coder 480B" */
export function modelName(id: string | undefined | null): string {
  if (!id || id === "none") return "the model";
  let n = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  n = n.replace(/-Instruct$/i, "").replace(/-A\d+B/i, "");
  n = n.replace(/-(\d+(?:\.\d+)?B)$/i, " $1");
  return n;
}

/** The model that wrote this run: the last attempt with a real model, else the run summary. */
export function runModel(run: RunLog | null): { name: string; provider: string } {
  if (!run) return { name: "Qwen3-Coder 480B", provider: "Featherless" };
  for (let i = run.attempts.length - 1; i >= 0; i--) {
    const m = run.attempts[i].model;
    if (m && m.id && m.id !== "none") return { name: modelName(m.id), provider: m.provider || "Featherless" };
  }
  return { name: modelName(run.model?.id), provider: "Featherless" };
}

export const failedCount = (a: Attempt) => (a.rules ? a.rules.failed.length : null);

export function amountRow(a: Attempt | null | undefined): ReconRow | undefined {
  return a?.reconciliation?.rows.find((r) => /amount due/i.test(r.check));
}

/** Plain-language step names (UI-SPEC §9). */
export const STEP_LABEL: Record<string, string> = {
  write: "Writing map.py",
  run: "Running map.py, network off",
  rules: "Checking the official rules",
  reconcile: "Tying totals to the source",
  provenance: "Tracing IDs to the source",
};

export function downloadBlob(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
