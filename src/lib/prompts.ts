// Prompts for the converter-writing agent. The model sees the source, the declared trading-partner config,
// an official Peppol example for structure, and, on later attempts, only the outcomes of the checks.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "./sources";
import type { Attempt } from "./runlog";
import { formatEUR } from "./money";

export const SYSTEM_PROMPT = `You write one complete Python 3.13 program, map.py, that converts an invoice from a billing system into a Peppol BIS Billing 3.0 e-invoice (UBL 2.1, EN 16931).

Keep map.py short and specific to this one source format: under 250 lines, no comments, no docstrings, no command-line parsing, no fallbacks for other formats.

Reply formats:
- When asked to write map.py: exactly one \`\`\`python code block with the whole program, nothing else.
- When asked to fix map.py: only SEARCH/REPLACE edit blocks, nothing else. Each block is
<<<<<<< SEARCH
(lines copied exactly from the current map.py)
=======
(the replacement lines)
>>>>>>> REPLACE
  Use as many blocks as needed. Only if more than half of the file must change, reply with the whole program in one \`\`\`python block instead.

The program must:
- read the source invoice from the file named in SOURCE_FILE (in the current directory) and the declared trading-partner configuration from ./partners.json;
- write ./out.xml: one UBL 2.1 <Invoice> that conforms to Peppol BIS Billing 3.0;
- use only the Python standard library (xml.etree.ElementTree, json, csv, decimal, datetime, re). There is no network: never try to download, install or fetch anything;
- compute money with decimal.Decimal and write every amount with exactly 2 decimals; amounts in cents must be divided by 100;
- take every identifier (VAT IDs, Peppol endpoint IDs with their schemeID, IBAN, party names, buyer reference) from the source or from partners.json. Never invent an identifier;
- keep the invoice faithful to the source: the same lines, the same discounts, the same VAT, and the amount due must equal what the source says was billed. A document-level discount becomes a document-level AllowanceCharge (ChargeIndicator false) with its own TaxCategory;
- get the line arithmetic right: each InvoiceLine's LineExtensionAmount = InvoicedQuantity x PriceAmount (/ BaseQuantity) - its own line-level allowances + its own line-level charges. If the source spreads an invoice-wide discount over the lines, still put it in ONE document-level AllowanceCharge and keep the line amounts undiscounted;
- use CustomizationID urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0 and ProfileID urn:fdc:peppol.eu:2017:poacc:billing:01:1.0;
- follow the element order of the reference invoice exactly (UBL is order-sensitive), register the cac/cbc namespaces, and write the XML declaration.`;

function reference(): string {
  return readFileSync(path.join(process.cwd(), "samples", "peppol-base-example.xml"), "utf8");
}

export function firstPrompt(source: Source): string {
  return [
    `SOURCE_FILE: ${source.fileName}  (${source.label})`,
    `--- ${source.fileName} ---`,
    source.raw.trim(),
    `--- partners.json ---`,
    JSON.stringify(source.partners, null, 2),
    `--- reference: an official Peppol BIS 3.0 example invoice. Follow its structure and element order; its values are NOT ours ---`,
    reference().trim(),
    `Write map.py.`,
  ].join("\n");
}

/** Plain explanations of rules models often misread, shown with the failure. */
const RULE_NOTES: Record<string, string> = {
  "PEPPOL-EN16931-R120": "Each line's LineExtensionAmount must equal InvoicedQuantity x PriceAmount (/ BaseQuantity) minus that line's own AllowanceCharge amounts plus its charges. Do not put a discount into the line amount without a line-level AllowanceCharge; an invoice-wide discount belongs in one document-level AllowanceCharge.",
  "BR-CO-10": "LegalMonetaryTotal/LineExtensionAmount must equal the sum of all InvoiceLine/LineExtensionAmount values.",
  "BR-CO-13": "TaxExclusiveAmount = sum of line amounts - document-level allowances + document-level charges.",
  "BR-CO-15": "TaxInclusiveAmount = TaxExclusiveAmount + the TaxTotal TaxAmount (in the document currency).",
  "BR-CO-16": "PayableAmount = TaxInclusiveAmount - PrepaidAmount + PayableRoundingAmount.",
  "BR-S-08": "For each standard-rated VAT rate, TaxSubtotal/TaxableAmount = sum of that rate's line amounts - document allowances of that rate + document charges of that rate.",
  "BR-06": "The seller name goes in AccountingSupplierParty/Party/PartyLegalEntity/RegistrationName.",
  "BR-07": "The buyer name goes in AccountingCustomerParty/Party/PartyLegalEntity/RegistrationName.",
};

const problemKey = (a: Attempt | undefined) => (a ? a.error ?? (a.rules?.failed.map((f) => f.id).sort().join(",") || a.outcome) : "");

/** True when the last fix changed nothing or the same problem came back: time for a full rewrite. */
export function isStuck(previous: Attempt[]): boolean {
  const last = previous[previous.length - 1];
  const before = previous[previous.length - 2];
  if (!last || !before) return false;
  return last.added + last.removed === 0 || problemKey(last) === problemKey(before);
}

export function fixPrompt(source: Source, last: Attempt, stuck = false): string {
  const lines: string[] = [`SOURCE_FILE: ${source.fileName}  (${source.label})`, `Your previous map.py:`, "```python", last.code, "```", "", "What happened when it ran in the sandbox:"];
  if (stuck) lines.push("- Your last fix did not change the outcome (or did not change map.py at all).");
  if (last.run && last.run.exitCode !== 0) {
    lines.push(`- map.py exited with code ${last.run.exitCode}. stderr (tail):`, last.run.stderrTail || "(empty)");
    if (last.run.networkBlocked) lines.push("- It tried to reach the network. The sandbox has no network; use only the files in the current directory.");
  }
  if (last.rules?.error) lines.push(`- ${last.rules.error}`);
  if (last.rules && last.rules.failed.length) {
    lines.push(`- ${last.rules.failed.length} official rules failed (rule id: message):`);
    for (const f of last.rules.failed.slice(0, 15)) lines.push(`  ${f.id} (${f.set}${f.count > 1 ? `, x${f.count}` : ""}): ${f.message}${f.location ? `\n    context: ${f.location}` : ""}${f.test ? `\n    the rule's XPath test (must be true): ${f.test}` : ""}${RULE_NOTES[f.id] ? `\n    note: ${RULE_NOTES[f.id]}` : ""}`);
  }
  if (last.reconciliation) {
    const bad = last.reconciliation.rows.filter((r) => !r.ties);
    if (bad.length) {
      lines.push("- The official rules passed, but the XML does not match the source invoice:");
      for (const r of bad) {
        const fmt = (v: number | null) => (v === null ? "missing" : r.unit === "money" ? formatEUR(v) : String(v));
        lines.push(`  ${r.check}: the XML says ${fmt(r.xml)}, the source says ${fmt(r.source)}`);
      }
    }
  }
  if (last.provenance && last.provenance.untraced.length) {
    lines.push("- These identifiers are not in the source or partners.json, so they were invented. Use only declared ones:");
    for (const u of last.provenance.untraced) lines.push(`  ${u.field}: ${u.value}`);
  }
  if (last.xml) lines.push("", "--- out.xml that your map.py wrote ---", last.xml.length > 14_000 ? last.xml.slice(0, 14_000) + "\n(truncated)" : last.xml.trim());
  lines.push("", `--- ${source.fileName} (unchanged) ---`, source.raw.trim(), `--- partners.json ---`, JSON.stringify(source.partners, null, 2), "", stuck ? "Rethink the approach and rewrite map.py in full: reply with one ```python block containing the whole program." : "Fix map.py. Reply with SEARCH/REPLACE edit blocks.");
  return lines.join("\n");
}
