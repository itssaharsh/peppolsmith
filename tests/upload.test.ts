import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectKind, sourceFromUpload, MAX_UPLOAD_BYTES } from "../src/lib/sources";
import { releaseToken, signRun, verifyRelease, verifyRun } from "../src/lib/sign";
import type { RunLog } from "../src/lib/runlog";

const example = (f: string) => readFileSync(`public/examples/${f}`, "utf8");

describe("uploaded invoices", () => {
  it("detects the three formats from content", () => {
    expect(detectKind(example("stripe-invoice.json"))).toBe("stripe");
    expect(detectKind(example("billing-export.csv"))).toBe("csv");
    expect(detectKind(example("cii-invoice.xml"))).toBe("cii");
    expect(detectKind('{"object":"customer"}')).toBeNull();
    expect(detectKind("<Invoice/>")).toBeNull();
    expect(detectKind("a,b,c\n1,2,3")).toBeNull();
  });

  it("builds reference totals from the upload itself", () => {
    expect(sourceFromUpload(example("stripe-invoice.json")).contract.payable).toBe(83970);
    expect(sourceFromUpload(example("billing-export.csv")).contract.payable).toBe(41954);
    expect(sourceFromUpload(example("cii-invoice.xml")).contract.payable).toBe(6545);
  });

  it("refuses unreadable or oversized files with a readable reason", () => {
    expect(() => sourceFromUpload("hello")).toThrow(/doesn't look like/);
    expect(() => sourceFromUpload('{"object":"invoice"}')).toThrow(/couldn't be read|missing/);
    expect(() => sourceFromUpload("x".repeat(MAX_UPLOAD_BYTES + 1))).toThrow(/larger than/);
  });

  it("signs the uploaded text: swapping the file breaks the signature", () => {
    process.env.RUN_SIGNING_SECRET = "test-secret";
    const raw = example("billing-export.csv");
    const run = {
      runId: "run-0123456789",
      source: { kind: "csv", label: "Your invoice (CSV export)", provenance: "", ref: "2026-0431", raw, custom: true },
      attempts: [],
      verdict: "running",
    } as unknown as RunLog;
    const signed = signRun(run);
    expect(verifyRun(signed)).toBe(true);
    expect(verifyRun({ ...signed, source: { ...signed.source, raw: raw.replace("212,00", "2,00") } })).toBe(false);
    expect(verifyRun({ ...signed, verdict: "certified" })).toBe(false);
    expect(signed.release).toBe(releaseToken("run-0123456789"));
    expect(verifyRelease("run-0123456789", signed.release)).toBe(true);
    expect(verifyRelease("run-9999999999", signed.release)).toBe(false);
  });
});
