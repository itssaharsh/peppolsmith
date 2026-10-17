// Reads the figures and identifiers out of a UBL 2.1 invoice (as written by the agent's map.py).
import { XMLParser } from "fast-xml-parser";
import { type Cents, toCents } from "./money";
import { rateKey } from "./sources";

export type UblFigures = {
  lines: Cents[];
  allowances: Cents[];
  charges: Cents[];
  taxExclusive: Cents | null;
  payable: Cents | null;
  vatTotal: Cents | null;
  vatByRate: Record<string, Cents>;
  identifiers: { field: string; value: string }[];
};

type Node = Record<string, unknown>;
const asArray = <T>(x: T | T[] | undefined | null): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: unknown): string =>
  typeof x === "object" && x !== null ? String((x as Node)["#text"] ?? "").trim() : String(x ?? "").trim();
const cents = (x: unknown): Cents | null => {
  const t = text(x);
  if (!t) return null;
  try {
    return toCents(t);
  } catch {
    return null;
  }
};

export function parseUbl(xml: string): UblFigures {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false }).parse(xml);
  const inv: Node = doc.Invoice ?? doc.CreditNote ?? {};
  const lines = asArray(inv.InvoiceLine as Node[]).map((l) => cents(l.LineExtensionAmount) ?? 0);
  const allowances: Cents[] = [];
  const charges: Cents[] = [];
  for (const ac of asArray(inv.AllowanceCharge as Node[])) {
    const amount = cents(ac.Amount) ?? 0;
    (text(ac.ChargeIndicator) === "true" ? charges : allowances).push(amount);
  }
  const lmt = (inv.LegalMonetaryTotal ?? {}) as Node;
  const vatByRate: Record<string, Cents> = {};
  let vatTotal: Cents | null = null;
  for (const tt of asArray(inv.TaxTotal as Node[])) {
    const amount = cents(tt.TaxAmount);
    if (amount !== null && vatTotal === null) vatTotal = amount;
    for (const sub of asArray(tt.TaxSubtotal as Node[])) {
      const cat = (sub.TaxCategory ?? {}) as Node;
      const pct = text(cat.Percent);
      if (pct !== "") vatByRate[rateKey(pct)] = (vatByRate[rateKey(pct)] ?? 0) + (cents(sub.TaxAmount) ?? 0);
    }
  }
  const identifiers: { field: string; value: string }[] = [];
  const push = (field: string, v: unknown) => {
    const t = text(v);
    if (t) identifiers.push({ field, value: t });
  };
  for (const [role, key] of [
    ["Seller", "AccountingSupplierParty"],
    ["Buyer", "AccountingCustomerParty"],
  ] as const) {
    const party = (((inv[key] ?? {}) as Node).Party ?? {}) as Node;
    push(`${role} Peppol endpoint`, party.EndpointID);
    for (const ts of asArray(party.PartyTaxScheme as Node[])) push(`${role} VAT ID`, ts.CompanyID);
    for (const le of asArray(party.PartyLegalEntity as Node[])) {
      push(`${role} legal name`, le.RegistrationName);
      push(`${role} company ID`, le.CompanyID);
    }
    for (const pn of asArray(party.PartyName as Node[])) push(`${role} name`, pn.Name);
  }
  for (const pm of asArray(inv.PaymentMeans as Node[])) push("Payee IBAN", ((pm.PayeeFinancialAccount ?? {}) as Node).ID);
  push("Buyer reference", inv.BuyerReference);
  return { lines, allowances, charges, taxExclusive: cents(lmt.TaxExclusiveAmount), payable: cents(lmt.PayableAmount), vatTotal, vatByRate, identifiers };
}
