// Gate G1: make sure the golden VM exists with the official validator, self-tested and egress-locked.
//   npx tsx scripts/bootstrap-vm.ts --self-test     (create or resume, then self-test + network probe)
//   npx tsx scripts/bootstrap-vm.ts --rebuild       (destroy and recreate; costs one daily sandbox creation)
import { existsSync } from "node:fs";
import { ensureGolden, findGolden, selfTest, probeNetwork, egressRules } from "../src/lib/sandbox";

if (existsSync(".env")) process.loadEnvFile(".env");
const log = (l: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${l}`);

async function main() {
  if (process.argv.includes("--rebuild")) {
    const old = await findGolden();
    if (old) {
      log(`destroying ${old.id}`);
      await old.destroy();
    }
  }
  const t = Date.now();
  const { sandbox, created, resumeMs } = await ensureGolden(log);
  log(`golden VM ${sandbox.id} running (${created ? "created" : resumeMs != null ? `resumed in ${resumeMs} ms` : "already running"}) in ${Date.now() - t} ms`);
  if (process.argv.includes("--self-test")) {
    const st = await selfTest(sandbox);
    log(`self-test: ${st.ok ? "PASS" : "FAIL"} ${JSON.stringify(st.results)}`);
    const rules = await egressRules(sandbox);
    const probe = await probeNetwork(sandbox);
    log(`egress rules ${JSON.stringify(rules)}; network probe ${probe.blocked ? "BLOCKED" : "REACHED"} (${probe.detail})`);
    if (!st.ok || !probe.blocked) process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
