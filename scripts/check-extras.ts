// Checks "Try to fool the gates" and the model-off converter against the golden VM:
//   npx tsx scripts/check-extras.ts [stripe|cii|csv ...]
// Each planted bug must pass the official rules and still be held; the second invoice must certify with 0 model calls.
import { existsSync } from "node:fs";
import { convert, fool, MUTATIONS, recorded, type Mutation } from "../src/lib/checks";
import { hasSecond, isSourceKind, loadSource, SOURCE_KINDS } from "../src/lib/sources";
import { newRunId } from "../src/lib/run";
import { ensureGolden } from "../src/lib/sandbox";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const kinds = process.argv.slice(2).filter(isSourceKind);
  const { sandbox } = await ensureGolden();
  let bad = 0;
  for (const kind of kinds.length ? kinds : SOURCE_KINDS) {
    const rec = recorded(kind);
    if (!rec) {
      console.log(`${kind}: no certified recording, skipped`);
      continue;
    }
    const source = loadSource(kind);
    for (const m of Object.keys(MUTATIONS) as Mutation[]) {
      const r = await fool(sandbox, newRunId(), source, rec.xml, m);
      const ok = r.outcome === "held_reconciliation" || r.outcome === "held_provenance";
      if (!ok && !r.error?.includes("no document-level discount")) bad++;
      console.log(`${kind} fool ${m.padEnd(9)} -> ${r.outcome.padEnd(20)} rules ${r.rules.failed.map((f) => f.id).join(",") || 0}  ${r.error ?? ""}  ${r.ms} ms`);
    }
    if (hasSecond(kind)) {
      const second = loadSource(kind, "second");
      const r = await convert(sandbox, newRunId(), second, rec.code);
      if (r.outcome !== "certified") bad++;
      console.log(`${kind} convert ${second.ref} -> ${r.outcome} rules ${r.rules.failed.map((f) => f.id).join(",") || 0} ${r.error ?? ""} ${r.ms} ms`);
      for (const row of r.reconciliation?.rows.filter((x) => !x.ties) ?? []) console.log(`   ${row.check}: xml ${row.xml} source ${row.source}`);
    }
  }
  process.exitCode = bad ? 1 : 0;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
