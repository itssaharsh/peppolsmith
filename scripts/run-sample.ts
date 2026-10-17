// Drives one full run from the terminal: npx tsx scripts/run-sample.ts <stripe|cii|csv> [--max N] [--record]
// or on any invoice file, as the upload box does: npx tsx scripts/run-sample.ts upload --upload <file>
// --record saves the run log as public/replay/<kind>.json (the labelled replay the page shows by default).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { startRun, stepRun } from "../src/lib/run";
import { isSourceKind } from "../src/lib/sources";
import { formatEUR } from "../src/lib/money";

if (existsSync(".env")) process.loadEnvFile(".env");
const uploadArg = process.argv.indexOf("--upload");
const upload = uploadArg > 0 ? readFileSync(process.argv[uploadArg + 1], "utf8") : undefined;
const kind = process.argv[2];
if (!isSourceKind(kind) && upload === undefined) {
  console.error("usage: run-sample.ts <stripe|cii|csv> [--max N] [--record]   or   run-sample.ts upload --upload <file> [--max N]");
  process.exit(2);
}
const maxArg = process.argv.indexOf("--max");
const max = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 6;
const log = (l: string) => console.log(`  · ${l}`);

async function main() {
  let run = await startRun((isSourceKind(kind) ? kind : "stripe") as never, log, upload);
  console.log(`run ${run.runId} on ${run.sandbox.vmId} (${run.source.label}${run.sandbox.resumeMs != null ? `, resumed in ${run.sandbox.resumeMs} ms` : ""})`);
  while (run.verdict === "running" && run.attempts.length < max) {
    run = await stepRun(run, log);
    const a = run.attempts[run.attempts.length - 1];
    const failed = a.rules ? a.rules.failed.length + (a.rules.error ? 1 : 0) : null;
    console.log(
      `attempt ${a.n}: ${a.outcome.padEnd(20)} rules failed ${failed ?? "-"}  model ${a.model.id.split("/").pop()} ${a.model.ms} ms  run ${a.run?.exitCode ?? "-"}  +${a.added}/-${a.removed}  ${(a.ms / 1000).toFixed(1)} s`,
    );
    if (a.rules?.failed.length) console.log(`    rules: ${a.rules.failed.map((f) => f.id).join(", ")}`);
    if (a.error) console.log(`    error: ${a.error.slice(0, 200)}`);
    if (a.reconciliation) for (const r of a.reconciliation.rows.filter((x) => !x.ties)) console.log(`    HOLD ${r.check}: xml ${r.unit === "money" && r.xml !== null ? formatEUR(r.xml) : r.xml} vs source ${r.unit === "money" && r.source !== null ? formatEUR(r.source) : r.source}`);
    if (a.provenance?.untraced.length) console.log(`    untraced: ${JSON.stringify(a.provenance.untraced)}`);
  }
  console.log(`verdict ${run.verdict}; model calls ${run.model.calls}; cost $${run.model.costUsd.toFixed(4)}`);
  mkdirSync(".runs", { recursive: true });
  writeFileSync(`.runs/${run.runId}.json`, JSON.stringify(run, null, 2));
  if (process.argv.includes("--record") && !upload) {
    mkdirSync("public/replay", { recursive: true });
    writeFileSync(`public/replay/${kind}.json`, JSON.stringify({ ...run, mode: "replay" }, null, 2));
    console.log(`recorded public/replay/${kind}.json`);
  }
  if (run.verdict !== "certified") process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
