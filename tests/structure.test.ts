import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ublStructure } from "../src/lib/gates";

const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

describe("UBL structure (no model)", () => {
  it("passes every recorded certified XML", () => {
    for (const k of ["cii", "stripe", "csv"]) {
      const run = JSON.parse(readFileSync(`public/replay/${k}.json`, "utf8"));
      expect(ublStructure(run.xml), k).toEqual([]);
    }
  });
  it("flags a stray attribute on the root, a wrong root and a foreign prefix", () => {
    const stray = `<?xml version="1.0"?><Invoice ${NS} nsmap="{'cac': 'x'}"><cbc:ID>1</cbc:ID></Invoice>`;
    expect(ublStructure(stray).map((i) => i.message).join(" ")).toMatch(/nsmap/);
    expect(ublStructure(`<CreditNote ${NS}><cbc:ID>1</cbc:ID></CreditNote>`).length).toBeGreaterThan(0);
    expect(ublStructure(`<Invoice ${NS} xmlns:x="urn:other"><x:Foo/></Invoice>`).map((i) => i.message).join(" ")).toMatch(/not a UBL namespace/);
  });
});
