import { describe, expect, it } from "vitest";
import { loadSource, SOURCE_KINDS } from "../src/lib/sources";

describe("demo sources", () => {
  it.each(SOURCE_KINDS)("%s loads with a self-consistent contract", (kind) => {
    const s = loadSource(kind);
    expect(s.raw.length).toBeGreaterThan(100);
    expect(s.contract.lines.length).toBeGreaterThanOrEqual(3);
    expect(s.contract.vatTotal).toBe(Object.values(s.contract.vatByRate).reduce((a, b) => a + b, 0));
    expect(s.contract.payable).toBe(s.contract.netTotal + s.contract.vatTotal);
    expect(s.partners).toBeTruthy();
  });
  it("CSV export has two Belgian VAT rates with BR-CO-17 rounding", () => {
    const c = loadSource("csv").contract;
    expect(c.vatByRate).toEqual({ "6": 1827, "21": 2625 });
    expect(c.payable).toBe(47402);
  });
});
