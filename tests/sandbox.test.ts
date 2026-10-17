import { describe, expect, it } from "vitest";
import { EGRESS_LOCK, looksLikeBlockedNetwork, safeRunId } from "../src/lib/sandbox";
import artefacts from "../vm/artefacts.json";

describe("sandbox helpers", () => {
  it("locks egress with a single non-routable IP rule (deny-by-default once any rule is set)", () => {
    expect(EGRESS_LOCK).toEqual(["192.0.2.1:9"]);
  });
  it("recognises a network failure inside the VM", () => {
    expect(looksLikeBlockedNetwork("urllib.error.URLError: <urlopen error [Errno -3] Temporary failure in name resolution>")).toBe(true);
    expect(looksLikeBlockedNetwork("KeyError: 'lines'")).toBe(false);
  });
  it("only accepts safe run ids", () => {
    expect(safeRunId("run-abc123")).toBe("run-abc123");
    expect(() => safeRunId("../etc")).toThrow();
    expect(() => safeRunId("x; rm -rf /")).toThrow();
  });
  it("pins every official artefact by sha256", () => {
    expect(artefacts.artefacts.length).toBeGreaterThanOrEqual(8);
    for (const a of artefacts.artefacts) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
