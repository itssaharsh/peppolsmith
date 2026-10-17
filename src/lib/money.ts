// Money as integer cents, parsed from decimal strings without floating-point drift.
export type Cents = number;

/** "553.21" -> 55321; "1.2605" -> 126 (half-up); "1.234,56" is NOT accepted here (see fromEuropean). */
export function toCents(value: string | number): Cents {
  const s = String(value).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`not a decimal amount: ${s}`);
  const [, sign, whole = "", frac = ""] = m;
  const padded = (frac + "000").slice(0, 3);
  let cents = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return sign ? -cents : cents;
}

/** European format: "1.234,56" or "84,50" -> cents. */
export function fromEuropean(value: string): Cents {
  return toCents(value.trim().replace(/\./g, "").replace(",", "."));
}

export function formatEUR(cents: Cents, currency = "EUR"): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(cents / 100);
}
