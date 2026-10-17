// PDF invoices: the AI reads the PDF's text into invoice data, then checks with no AI decide whether that reading can
// be trusted: every amount and ID it read must be printed on the PDF, and the arithmetic must add up. Only then does
// the data go through the same write -> run -> fix loop as any other upload (as a CSV in our layout).
import { extractText, getDocumentProxy } from "unpdf";
import { askJson } from "./agent";
import { formatEUR } from "./money";
import { sourceFromUpload, type Source } from "./sources";

export const MAX_PDF_BYTES = 2_000_000;

export type PdfInvoice = {
  invoice_no: string;
  invoice_date: string; // DD/MM/YYYY
  due_date: string; // DD/MM/YYYY
  currency: string;
  seller: { name: string; vat: string; street: string; postcode: string; city: string; country: string; iban: string };
  buyer: { name: string; vat: string; street: string; postcode: string; city: string; country: string };
  lines: { description: string; quantity: number; unit_price: number; vat_rate: number; amount: number }[];
  net_total: number;
  vat_total: number;
  amount_due: number;
};

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return String(text).replace(/\u0000/g, "").trim();
}

const SYSTEM = `You read the text of one invoice and return its data as JSON, nothing else, in one \`\`\`json block with exactly these keys:
{"invoice_no": "", "invoice_date": "DD/MM/YYYY", "due_date": "DD/MM/YYYY", "currency": "EUR",
 "seller": {"name": "", "vat": "", "street": "", "postcode": "", "city": "", "country": "two-letter code", "iban": ""},
 "buyer": {"name": "", "vat": "", "street": "", "postcode": "", "city": "", "country": "two-letter code"},
 "lines": [{"description": "", "quantity": 1, "unit_price": 0.00, "vat_rate": 21, "amount": 0.00}],
 "net_total": 0.00, "vat_total": 0.00, "amount_due": 0.00}
Rules: copy every value exactly as printed (amounts as plain numbers with a dot for decimals, VAT numbers and IBANs without spaces). Never compute, guess or invent a value; use "" for anything not printed. A discount is a line with a negative amount.`;

/** The AI's reading of the PDF text. */
export async function readInvoice(text: string): Promise<{ data: PdfInvoice; model: string; costUsd: number }> {
  const r = await askJson(SYSTEM, `Invoice text:\n${text.slice(0, 20_000)}`);
  const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(r.text);
  const body = (m ? m[1] : r.text).trim();
  const data = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)) as PdfInvoice;
  return { data, model: r.modelId, costUsd: r.costUsd };
}

const cents = (n: number) => Math.round(Number(n) * 100);

/** Every amount printed on the PDF, in cents, in either 1.234,56 or 1,234.56 style. */
function printedAmounts(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/-?\d{1,3}(?:[ ., ]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g)) {
    const s = m[0].replace(/[  ]/g, "");
    const dec = s.slice(-3, -2);
    const whole = s.slice(0, -3).replace(/[.,]/g, "");
    out.add(Math.abs(Number(`${whole}.${s.slice(-2)}`) * 100) | 0);
    void dec;
  }
  return out;
}

const squash = (s: string) => s.replace(/[\s.\-]/g, "").toUpperCase();

/** Checks with no AI. An empty list means the reading can be trusted. */
export function verifyReading(d: PdfInvoice, text: string): string[] {
  const problems: string[] = [];
  const printed = printedAmounts(text);
  const flat = squash(text);
  const onPdf = (label: string, n: number) => {
    if (!printed.has(Math.abs(cents(n)))) problems.push(`${label} ${formatEUR(cents(n))} isn't printed on the PDF.`);
  };
  if (!Array.isArray(d.lines) || d.lines.length === 0) return ["No invoice lines were found on the PDF."];
  if (!d.invoice_no || !flat.includes(squash(d.invoice_no))) problems.push(`The invoice number "${d.invoice_no}" isn't printed on the PDF.`);
  for (const [who, vat] of [["Seller", d.seller?.vat], ["Buyer", d.buyer?.vat]] as const) {
    if (!vat || !flat.includes(squash(vat))) problems.push(`${who} VAT number "${vat ?? ""}" isn't printed on the PDF.`);
  }
  if (d.seller?.iban && !flat.includes(squash(d.seller.iban))) problems.push(`IBAN "${d.seller.iban}" isn't printed on the PDF.`);
  d.lines.forEach((l, i) => {
    onPdf(`Line ${i + 1} amount`, l.amount);
    if (Math.abs(Math.round(Number(l.quantity) * Number(l.unit_price) * 100) - cents(l.amount)) > 1) {
      problems.push(`Line ${i + 1}: ${l.quantity} x ${formatEUR(cents(l.unit_price))} isn't ${formatEUR(cents(l.amount))}.`);
    }
  });
  onPdf("The net total", d.net_total);
  onPdf("The amount due", d.amount_due);
  // many invoices print VAT per rate only: an unprinted VAT total is fine if it is exactly due - net, both printed
  if (!printed.has(Math.abs(cents(d.vat_total))) && Math.abs(cents(d.amount_due) - cents(d.net_total) - cents(d.vat_total)) > 1) {
    problems.push(`The VAT total ${formatEUR(cents(d.vat_total))} isn't printed on the PDF and isn't the amount due minus the net total.`);
  }
  const sum = d.lines.reduce((s, l) => s + cents(l.amount), 0);
  if (Math.abs(sum - cents(d.net_total)) > 1) problems.push(`The lines add up to ${formatEUR(sum)}, not the net total ${formatEUR(cents(d.net_total))}.`);
  const byRate = new Map<number, number>();
  for (const l of d.lines) byRate.set(Number(l.vat_rate), (byRate.get(Number(l.vat_rate)) ?? 0) + cents(l.amount));
  const vat = [...byRate].reduce((s, [rate, base]) => s + Math.round((base * rate) / 100), 0);
  if (Math.abs(vat - cents(d.vat_total)) > 2) problems.push(`VAT on the lines comes to ${formatEUR(vat)}, not the printed ${formatEUR(cents(d.vat_total))}.`);
  if (Math.abs(cents(d.net_total) + cents(d.vat_total) - cents(d.amount_due)) > 1) {
    problems.push(`Net ${formatEUR(cents(d.net_total))} plus VAT ${formatEUR(cents(d.vat_total))} isn't the amount due ${formatEUR(cents(d.amount_due))}.`);
  }
  if ((d.currency || "EUR").toUpperCase() !== "EUR") problems.push("Only invoices in euro are supported in this demo.");
  return problems;
}

const euro = (n: number) => Number(n).toFixed(2).replace(".", ",");

/** The verified reading as a CSV in our export layout, so it runs through the same loop and checks. */
export function toCsv(d: PdfInvoice): string {
  const head = "invoice_no;invoice_date;due_date;customer_name;customer_vat;customer_street;customer_postcode;customer_city;customer_country;line;description;qty;unit_price;vat_rate";
  const clean = (s: unknown) => String(s ?? "").replace(/[;\r\n]/g, " ").trim();
  const rows = d.lines.map((l, i) =>
    [d.invoice_no, d.invoice_date, d.due_date, d.buyer.name, d.buyer.vat, d.buyer.street, d.buyer.postcode, d.buyer.city, d.buyer.country, i + 1, l.description, String(l.quantity).replace(".", ","), euro(l.unit_price), `${Number(l.vat_rate)}%`]
      .map(clean)
      .join(";"),
  );
  return [head, ...rows].join("\n") + "\n";
}

/** Peppol endpoint IDs derived from VAT numbers (the PDF carries no Peppol IDs). */
const SCHEMES: Record<string, (vat: string) => { scheme: string; id: string }> = {
  BE: (v) => ({ scheme: "0208", id: v.replace(/\D/g, "").padStart(10, "0") }),
  DE: (v) => ({ scheme: "9930", id: v }),
  NL: (v) => ({ scheme: "9944", id: v }),
  FR: (v) => ({ scheme: "9957", id: v }),
};

export function endpointFor(vat: string): { scheme: string; id: string } | null {
  const v = squash(vat);
  const f = SCHEMES[v.slice(0, 2)];
  return f ? f(v) : null;
}

/** The declared settings for this upload, taken from the verified PDF instead of a config file. */
export function partnersFrom(d: PdfInvoice): Record<string, unknown> {
  const seller = endpointFor(d.seller.vat);
  const buyer = endpointFor(d.buyer.vat);
  if (!seller || !buyer) throw new Error("Peppol IDs can be derived for Belgian, German, Dutch and French VAT numbers in this demo.");
  return {
    seller: { name: d.seller.name, vat: squash(d.seller.vat), endpoint: seller, iban: squash(d.seller.iban || ""), street: d.seller.street, postcode: d.seller.postcode, city: d.seller.city, country: d.seller.country },
    buyer: { endpoint: buyer, buyer_reference: d.invoice_no },
  };
}

export const PDF_PROVENANCE =
  "Read from your PDF by the AI, then checked with no AI: every amount, the invoice number and the VAT numbers are printed on the PDF, and the arithmetic adds up. Peppol IDs are derived from the VAT numbers.";

/** PDF bytes to a source the agent loop can run, or a readable reason why not. */
export async function sourceFromPdf(bytes: Uint8Array): Promise<{ source: Source; costUsd: number; model: string }> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error(`The PDF is larger than ${MAX_PDF_BYTES / 1_000_000} MB.`);
  let text: string;
  try {
    text = await pdfText(bytes);
  } catch {
    throw new Error("This file couldn't be opened as a PDF.");
  }
  if (text.replace(/\s/g, "").length < 40) throw new Error("This PDF has no text layer (it's probably a scan or a photo), so there is nothing to read.");
  let reading: Awaited<ReturnType<typeof readInvoice>>;
  try {
    reading = await readInvoice(text);
  } catch {
    throw new Error("The AI couldn't read this PDF as an invoice.");
  }
  const problems = verifyReading(reading.data, text);
  if (problems.length) throw new Error(`The AI's reading of this PDF didn't pass the checks, so nothing was converted. ${problems.slice(0, 4).join(" ")}`);
  const partners = partnersFrom(reading.data);
  const source = sourceFromUpload(toCsv(reading.data), { label: "Your invoice (PDF)", provenance: PDF_PROVENANCE, partners });
  if (Math.abs(source.contract.payable - cents(reading.data.amount_due)) > 2) {
    throw new Error(`The invoice lines come to ${formatEUR(source.contract.payable)}, but the PDF says ${formatEUR(cents(reading.data.amount_due))} is due.`);
  }
  return { source, costUsd: reading.costUsd, model: reading.model };
}
