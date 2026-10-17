import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfText, verifyReading, toCsv, partnersFrom, type PdfInvoice } from "../src/lib/pdf";
import { sourceFromUpload } from "../src/lib/sources";

const reading: PdfInvoice = {
  invoice_no: "2026-0457",
  invoice_date: "17/10/2026",
  due_date: "16/11/2026",
  currency: "EUR",
  seller: { name: "Traiteur Vanneste BV", vat: "BE0731602803", street: "Groentemarkt 7", postcode: "9000", city: "Gent", country: "BE", iban: "BE68539007547034" },
  buyer: { name: "Studio Noordzee BV", vat: "BE0649375210", street: "Zeedijk 120", postcode: "8400", city: "Oostende", country: "BE" },
  lines: [
    { description: "Buffet lunch, 15 persons", quantity: 1, unit_price: 247.5, vat_rate: 6, amount: 247.5 },
    { description: "Coffee and tea service, half day", quantity: 2, unit_price: 45, vat_rate: 21, amount: 90 },
    { description: "Delivery and set-up", quantity: 1, unit_price: 35, vat_rate: 21, amount: 35 },
    { description: "Dessert platter", quantity: 3, unit_price: 18.9, vat_rate: 6, amount: 56.7 },
  ],
  net_total: 429.2,
  vat_total: 44.5,
  amount_due: 473.7,
};

describe("PDF invoices: the AI's reading is checked with no AI", () => {
  it("accepts a faithful reading of the example PDF and converts it like a CSV upload", async () => {
    const text = await pdfText(new Uint8Array(readFileSync("public/examples/invoice.pdf")));
    expect(verifyReading(reading, text)).toEqual([]);
    const src = sourceFromUpload(toCsv(reading), { label: "Your invoice (PDF)", provenance: "", partners: partnersFrom(reading) });
    expect(src.contract.payable).toBe(47370);
    expect(partnersFrom(reading)).toMatchObject({ buyer: { endpoint: { scheme: "0208", id: "0649375210" } } });
  });

  it("refuses an amount, an ID or arithmetic that isn't on the PDF", async () => {
    const text = await pdfText(new Uint8Array(readFileSync("public/examples/invoice.pdf")));
    const invented = { ...reading, amount_due: 573.7 };
    expect(verifyReading(invented, text).join(" ")).toMatch(/isn't printed on the PDF/);
    const wrongVat = { ...reading, buyer: { ...reading.buyer, vat: "BE0999999999" } };
    expect(verifyReading(wrongVat, text).join(" ")).toMatch(/Buyer VAT number/);
    const badLine = { ...reading, lines: reading.lines.map((l, i) => (i === 1 ? { ...l, quantity: 3 } : l)) };
    expect(verifyReading(badLine, text).join(" ")).toMatch(/Line 2/);
  });
});
