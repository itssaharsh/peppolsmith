// The two model-free release gates. They compare the agent's XML with the human-written source contract
// and the declared configuration; the official rules (run in the VM) are the third gate.
import type { Cents } from "./money";
import type { Source, SourceContract } from "./sources";
import { parseUbl } from "./ubl";

export type ReconRow = { check: string; unit: "money" | "count"; source: Cents | null; xml: Cents | null; ties: boolean };
export type Reconciliation = { ties: boolean; rows: ReconRow[] };

/** Can every XML line be paired with a distinct source line, before or after its share of a discount? */
function matchLines(xml: Cents[], source: SourceContract["lines"]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const amount of xml) {
    const i = source.findIndex((l, idx) => !used.has(idx) && (l.grossNet === amount || l.discountedNet === amount));
    if (i >= 0) {
      used.add(i);
      matched++;
    }
  }
  return matched;
}

export function reconcile(xml: string, contract: SourceContract): Reconciliation {
  const u = parseUbl(xml);
  const rows: ReconRow[] = [];
  const row = (check: string, unit: ReconRow["unit"], source: Cents | null, x: Cents | null) =>
    rows.push({ check, unit, source, xml: x, ties: source !== null && x !== null && source === x });
  row("Lines", "count", contract.lines.length, u.lines.length);
  const matched = matchLines(u.lines, contract.lines);
  rows.push({ check: "Line amounts", unit: "count", source: contract.lines.length, xml: matched, ties: matched === contract.lines.length && u.lines.length === contract.lines.length });
  row("Net total (before VAT)", "money", contract.netTotal, u.taxExclusive);
  const rates = new Set([...Object.keys(contract.vatByRate), ...Object.keys(u.vatByRate)]);
  for (const r of [...rates].sort((a, b) => Number(b) - Number(a))) row(`VAT ${r}%`, "money", contract.vatByRate[r] ?? null, u.vatByRate[r] ?? null);
  row("Amount due", "money", contract.payable, u.payable);
  return { ties: rows.every((r) => r.ties), rows };
}

export type Provenance = { total: number; traced: number; untraced: { field: string; value: string }[] };

const norm = (s: string) => s.toUpperCase().replace(/[\s.\-_/]/g, "");

function flatten(x: unknown, out: string[] = []): string[] {
  if (x === null || x === undefined) return out;
  if (typeof x === "object") for (const v of Object.values(x as Record<string, unknown>)) flatten(v, out);
  else out.push(String(x));
  return out;
}

/** Every identifier in the XML must appear in the source or in the declared trading-partner config. */
export function provenance(xml: string, source: Pick<Source, "raw" | "partners">): Provenance {
  const ids = parseUbl(xml).identifiers;
  const haystack = norm(source.raw) + "|" + flatten(source.partners).map(norm).join("|");
  const declared = new Set(flatten(source.partners).map(norm));
  const untraced = ids.filter(({ value }) => {
    const v = norm(value);
    if (v.length === 0) return false;
    return v.length >= 4 ? !haystack.includes(v) : !declared.has(v);
  });
  return { total: ids.length, traced: ids.length - untraced.length, untraced };
}
