import { describe, expect, it } from "vitest";
import { applyEdits, hasEditBlocks } from "../src/lib/edits";

const prev = "import json\ntotal = 1\nprint(total)\n";
describe("SEARCH/REPLACE edits", () => {
  it("applies a matching block", () => {
    const reply = "<<<<<<< SEARCH\ntotal = 1\n=======\ntotal = 2\n>>>>>>> REPLACE";
    expect(hasEditBlocks(reply)).toBe(true);
    const r = applyEdits(prev, reply);
    expect(r.applied).toBe(1);
    expect(r.code).toBe("import json\ntotal = 2\nprint(total)\n");
  });
  it("reports a block that does not match", () => {
    const r = applyEdits(prev, "<<<<<<< SEARCH\nnot there\n=======\nx\n>>>>>>> REPLACE");
    expect(r.applied).toBe(0);
    expect(r.failed).toHaveLength(1);
  });
  it("tolerates trailing whitespace", () => {
    const r = applyEdits("a = 1   \nb = 2\n", "<<<<<<< SEARCH\na = 1\n=======\na = 3\n>>>>>>> REPLACE");
    expect(r.applied).toBe(1);
    expect(r.code).toContain("a = 3");
  });
});
