import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reconcile, provenance } from "../src/lib/gates";
import { loadSource } from "../src/lib/sources";
import { toCents } from "../src/lib/money";

// A minimal UBL invoice shaped like Peppol BIS 3.0, filled from the Stripe sample's real figures.
function ubl(opts: { lines: string[]; allowance?: string; taxExcl: string; vat: string; payable: string; buyerEndpoint?: string }) {
  const lines = opts.lines
    .map((amt, i) => `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:LineExtensionAmount currencyID="EUR">${amt}</cbc:LineExtensionAmount></cac:InvoiceLine>`)
    .join("");
  const allowance = opts.allowance
    ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="EUR">${opts.allowance}</cbc:Amount></cac:AllowanceCharge>`
    : "";
  return `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0208">0847193149</cbc:EndpointID><cac:PartyTaxScheme><cbc:CompanyID>BE0847193149</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="0208">${opts.buyerEndpoint ?? "0764221032"}</cbc:EndpointID><cac:PartyTaxScheme><cbc:CompanyID>BE0764221032</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Brasserie De Kaai NV</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
${allowance}
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${opts.vat}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${opts.taxExcl}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${opts.vat}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">${opts.taxExcl}</cbc:TaxExclusiveAmount><cbc:PayableAmount currencyID="EUR">${opts.payable}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines}</Invoice>`;
}

const stripe = loadSource("stripe");

describe("money", () => {
  it("parses decimals to integer cents without float drift", () => {
    expect(toCents("553.21")).toBe(55321);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("1.2605")).toBe(126);
    expect(toCents("-50.80")).toBe(-5080);
  });
});

describe("source contract (human-written, the agent never sees this code)", () => {
  it("reads the Stripe test invoice's real figures", () => {
    expect(stripe.contract.lines).toHaveLength(3);
    expect(stripe.contract.netTotal).toBe(45720);
    expect(stripe.contract.vatTotal).toBe(9601);
    expect(stripe.contract.payable).toBe(55321);
    expect(stripe.contract.vatByRate).toEqual({ "21": 9601 });
  });
  it("reads the official CEN CII example's figures", () => {
    const cii = loadSource("cii");
    expect(cii.contract.lines).toHaveLength(3);
    expect(cii.contract.netTotal).toBe(1000);
    expect(cii.contract.vatTotal).toBe(190);
    expect(cii.contract.payable).toBe(1190);
  });
  it("reads the European-format CSV export", () => {
    const csv = loadSource("csv");
    expect(csv.contract.lines.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(csv.contract.vatByRate).sort()).toEqual(["21", "6"]);
    expect(csv.contract.payable).toBe(csv.contract.netTotal + csv.contract.vatTotal);
  });
});

describe("reconciliation gate", () => {
  it("ties when the coupon is a document-level allowance", () => {
    const r = reconcile(ubl({ lines: ["30.00", "120.00", "358.00"], allowance: "50.80", taxExcl: "457.20", vat: "96.01", payable: "553.21" }), stripe.contract);
    expect(r.ties).toBe(true);
  });
  it("ties when the coupon is spread over the lines", () => {
    const r = reconcile(ubl({ lines: ["27.00", "108.00", "322.20"], taxExcl: "457.20", vat: "96.01", payable: "553.21" }), stripe.contract);
    expect(r.ties).toBe(true);
  });
  it("HOLDS an invoice that dropped the coupon even though it is internally consistent", () => {
    const r = reconcile(ubl({ lines: ["30.00", "120.00", "358.00"], taxExcl: "508.00", vat: "106.68", payable: "614.68" }), stripe.contract);
    expect(r.ties).toBe(false);
    const due = r.rows.find((x) => x.check === "Amount due");
    expect(due?.ties).toBe(false);
    expect(due?.source).toBe(55321);
    expect(due?.xml).toBe(61468);
  });
  it("HOLDS the cents bug (every amount x100)", () => {
    const r = reconcile(ubl({ lines: ["3000.00", "12000.00", "35800.00"], allowance: "5080.00", taxExcl: "45720.00", vat: "9601.20", payable: "55321.00" }), stripe.contract);
    expect(r.ties).toBe(false);
  });
});

describe("provenance gate", () => {
  it("traces every identifier to the source or the declared config", () => {
    const p = provenance(ubl({ lines: ["30.00", "120.00", "358.00"], allowance: "50.80", taxExcl: "457.20", vat: "96.01", payable: "553.21" }), stripe);
    expect(p.untraced).toEqual([]);
    expect(p.total).toBeGreaterThanOrEqual(4);
  });
  it("HOLDS an invented buyer endpoint", () => {
    const p = provenance(ubl({ lines: ["30.00", "120.00", "358.00"], allowance: "50.80", taxExcl: "457.20", vat: "96.01", payable: "553.21", buyerEndpoint: "0999999999" }), stripe);
    expect(p.untraced.map((u) => u.value)).toContain("0999999999");
  });
});

describe("samples on disk", () => {
  it("bundles the Stripe invoice as test-mode data", () => {
    const j = JSON.parse(readFileSync("samples/stripe-invoice.json", "utf8"));
    expect(j.livemode).toBe(false);
  });
});
