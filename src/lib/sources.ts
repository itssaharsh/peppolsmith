// The three demo sources and their human-written source contracts: the independent reference the
// reconciliation and provenance gates check against. The agent never sees or edits this file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import partnersFile from "../../config/trading-partners.json";
import { type Cents, toCents, fromEuropean } from "./money";

export type SourceKind = "stripe" | "cii" | "csv";
export const SOURCE_KINDS: SourceKind[] = ["stripe", "cii", "csv"];

export type ContractLine = { description: string; quantity: number; grossNet: Cents; discountedNet: Cents };
export type SourceContract = {
  currency: string;
  lines: ContractLine[];
  netTotal: Cents; // after discounts, before VAT (UBL TaxExclusiveAmount)
  vatTotal: Cents;
  vatByRate: Record<string, Cents>;
  payable: Cents;
};

export type Source = {
  kind: SourceKind;
  label: string;
  provenance: string;
  ref: string;
  fileName: string; // the name map.py reads inside the VM
  raw: string;
  contract: SourceContract;
  partners: unknown;
};

const META: Record<SourceKind, { file: string; fileName: string; label: string; provenance: string }> = {
  stripe: {
    file: "samples/stripe-invoice.json",
    fileName: "source.json",
    label: "Stripe test invoice",
    provenance: "A real Stripe Invoice object from a test-mode sandbox (fictional Belgian buyer, 10% coupon), retrieved with the Stripe API.",
  },
  cii: {
    file: "samples/cii-business-example-02.xml",
    fileName: "source.xml",
    label: "CEN CII example invoice",
    provenance: "The official CEN EN16931 example CII_business_example_02.xml (release validation-1.3.17, EUPL-1.2).",
  },
  csv: {
    file: "samples/billing-export.csv",
    fileName: "source.csv",
    label: "Billing app CSV export",
    provenance: "A home-grown billing export in European format (semicolons, comma decimals, two VAT rates), written by us.",
  },
};

export const rateKey = (pct: number | string): string => String(Number(pct));

function stripeContract(raw: string): { contract: SourceContract; ref: string } {
  const d = JSON.parse(raw);
  const rateById = new Map<string, number>();
  for (const r of d.default_tax_rates ?? []) rateById.set(r.id, Number(r.effective_percentage ?? r.percentage));
  const lines: ContractLine[] = d.lines.data.map((l: { description: string; quantity: number; amount: number; discount_amounts?: { amount: number }[] }) => {
    const discount = (l.discount_amounts ?? []).reduce((s, x) => s + x.amount, 0);
    return { description: l.description, quantity: l.quantity, grossNet: l.amount, discountedNet: l.amount - discount };
  });
  const vatByRate: Record<string, Cents> = {};
  for (const t of d.total_taxes ?? []) {
    const rate = rateById.get(t.tax_rate_details?.tax_rate) ?? 0;
    vatByRate[rateKey(rate)] = (vatByRate[rateKey(rate)] ?? 0) + t.amount;
  }
  const vatTotal = Object.values(vatByRate).reduce((s, x) => s + x, 0);
  return {
    ref: d.id,
    contract: { currency: String(d.currency).toUpperCase(), lines, netTotal: d.total_excluding_tax, vatTotal, vatByRate, payable: d.amount_due },
  };
}

const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const text = (x: unknown): string => (typeof x === "object" && x !== null ? String((x as Record<string, unknown>)["#text"] ?? "") : String(x ?? ""));

function ciiContract(raw: string): { contract: SourceContract; ref: string } {
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(raw).CrossIndustryInvoice;
  const tx = doc.SupplyChainTradeTransaction;
  const lines: ContractLine[] = asArray(tx.IncludedSupplyChainTradeLineItem).map((li: Record<string, any>) => {
    const net = toCents(text(li.SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount));
    return { description: text(li.SpecifiedTradeProduct.Name), quantity: Number(text(li.SpecifiedLineTradeDelivery.BilledQuantity)), grossNet: net, discountedNet: net };
  });
  const st = tx.ApplicableHeaderTradeSettlement;
  const sum = st.SpecifiedTradeSettlementHeaderMonetarySummation;
  const vatByRate: Record<string, Cents> = {};
  for (const t of asArray(st.ApplicableTradeTax) as Record<string, unknown>[]) {
    vatByRate[rateKey(text(t.RateApplicablePercent))] = toCents(text(t.CalculatedAmount));
  }
  return {
    ref: text(doc.ExchangedDocument.ID),
    contract: {
      currency: text(st.InvoiceCurrencyCode),
      lines,
      netTotal: toCents(text(sum.TaxBasisTotalAmount)),
      vatTotal: toCents(text(sum.TaxTotalAmount)),
      vatByRate,
      payable: toCents(text(sum.DuePayableAmount)),
    },
  };
}

function csvContract(raw: string): { contract: SourceContract; ref: string } {
  const [header, ...rows] = raw.trim().split(/\r?\n/).map((l) => l.split(";"));
  const col = (name: string) => header.indexOf(name);
  const baseByRate: Record<string, Cents> = {};
  const lines: ContractLine[] = rows.map((r) => {
    const qty = Number(r[col("qty")].replace(",", "."));
    const unit = fromEuropean(r[col("unit_price")]);
    const net = Math.round(qty * unit);
    const rate = rateKey(r[col("vat_rate")].replace("%", "").replace(",", "."));
    baseByRate[rate] = (baseByRate[rate] ?? 0) + net;
    return { description: r[col("description")], quantity: qty, grossNet: net, discountedNet: net };
  });
  // EN16931 BR-CO-17: VAT per category = taxable amount x rate, rounded to 2 decimals.
  const vatByRate: Record<string, Cents> = {};
  for (const [rate, base] of Object.entries(baseByRate)) vatByRate[rate] = Math.round((base * Number(rate)) / 100);
  const netTotal = lines.reduce((s, l) => s + l.grossNet, 0);
  const vatTotal = Object.values(vatByRate).reduce((s, x) => s + x, 0);
  return { ref: rows[0][col("invoice_no")], contract: { currency: "EUR", lines, netTotal, vatTotal, vatByRate, payable: netTotal + vatTotal } };
}

export function loadSource(kind: SourceKind): Source {
  const meta = META[kind];
  const raw = readFileSync(path.join(process.cwd(), meta.file), "utf8");
  const { contract, ref } = kind === "stripe" ? stripeContract(raw) : kind === "cii" ? ciiContract(raw) : csvContract(raw);
  return { kind, label: meta.label, provenance: meta.provenance, ref, fileName: meta.fileName, raw, contract, partners: (partnersFile as Record<string, unknown>)[kind] };
}

export function isSourceKind(x: unknown): x is SourceKind {
  return typeof x === "string" && (SOURCE_KINDS as string[]).includes(x);
}
