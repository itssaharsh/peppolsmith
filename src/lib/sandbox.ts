// CreateOS Sandbox layer: one golden devbox:1 VM holds the official validator; every model-written
// map.py runs in it as an unprivileged user, with outbound network locked at the host.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { createClient, type Sandbox } from "@nodeops-createos/sandbox";
import artefacts from "../../vm/artefacts.json";

export const GOLDEN_NAME = "peppolsmith-golden";
export const SHAPE = "s-1vcpu-1gb";
export const IMAGE = "devbox:1";
// Any rule switches CreateOS egress to deny-by-default; an IP rule to TEST-NET-1 lets nothing out.
export const EGRESS_LOCK = ["192.0.2.1:9"];
const TERMINAL = new Set(["destroyed", "destroying", "failed"]);

export type Log = (line: string) => void;
const quiet: Log = () => {};

function apiKey(): string {
  const key = process.env.CREATEOS_PROJECT_API_KEY ?? process.env.CREATEOS_API_KEY;
  if (!key) throw new Error("CREATEOS_PROJECT_API_KEY is not set (stripe projects env --pull)");
  return key;
}

export function client() {
  return createClient({ apiKey: apiKey() });
}

export function safeRunId(runId: string): string {
  if (!/^[a-z0-9-]{6,40}$/.test(runId)) throw new Error("bad run id");
  return runId;
}

export async function findGolden(): Promise<Sandbox | null> {
  const all = await client().listSandboxes();
  return all.find((s) => s.name === GOLDEN_NAME && !TERMINAL.has(s.status)) ?? null;
}

export type GoldenInfo = { sandbox: Sandbox; created: boolean; resumeMs: number | null };

/** Returns a running golden VM: resumes it if paused, rebuilds it if broken, creates it if missing. */
export async function ensureGolden(log: Log = quiet): Promise<GoldenInfo> {
  let sb = await findGolden();
  if (sb && sb.status === "error") {
    log(`golden VM ${sb.id} is in error; rebuilding`);
    await sb.destroy();
    sb = null;
  }
  if (!sb) {
    const created = await createGolden(log);
    return { sandbox: created, created: true, resumeMs: null };
  }
  let resumeMs: number | null = null;
  if (sb.status === "pausing") await sb.waitUntilPaused();
  if (sb.status === "paused") {
    const t = Date.now();
    log(`resuming golden VM ${sb.id}`);
    await sb.resume();
    await sb.waitUntilRunning();
    resumeMs = Date.now() - t;
  } else if (sb.status !== "running") {
    await sb.waitUntilRunning();
  }
  return { sandbox: sb, created: false, resumeMs };
}

/** For public routes: the golden VM, resumed if paused, never created (creation is a scripted, rate-limited step). */
export async function resumeGolden(): Promise<{ sandbox: Sandbox; resumeMs: number | null } | null> {
  const sb = await findGolden();
  if (!sb || sb.status === "error") return null;
  if (sb.status === "pausing") await sb.waitUntilPaused();
  if (sb.status === "paused") {
    const t = Date.now();
    await sb.resume();
    await sb.waitUntilRunning();
    return { sandbox: sb, resumeMs: Date.now() - t };
  }
  if (sb.status !== "running") await sb.waitUntilRunning();
  return { sandbox: sb, resumeMs: null };
}

async function createGolden(log: Log): Promise<Sandbox> {
  log(`creating ${IMAGE} ${SHAPE} VM "${GOLDEN_NAME}"`);
  const sb = await client().createSandbox(
    { shape: SHAPE, rootfs: IMAGE, name: GOLDEN_NAME, auto_pause_after_seconds: 600 },
    { wait: true, waitTimeoutMs: 120_000 },
  );
  await bootstrap(sb, log);
  return sb;
}

export function validatorSource(): string {
  return readFileSync(path.join(process.cwd(), "vm", "validate.py"), "utf8");
}

/** Installs the official validator, compiles the Peppol rules, self-tests, then locks egress. */
export async function bootstrap(sb: Sandbox, log: Log = quiet): Promise<SelfTest> {
  log("checking the image (python, runuser, nobody)");
  await sb.sh("command -v runuser && id nobody && python3 --version", { label: "image check" });
  log("installing SaxonC-HE (saxonche<13) into /opt/v");
  await sb.sh("python3 -m venv /opt/v && /opt/v/bin/pip install -q 'saxonche<13'", {
    label: "pip install",
    timeoutMs: 240_000,
  });
  log("uploading the official rule files (pinned by sha256)");
  for (const a of artefacts.artefacts) {
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`download failed ${a.file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== a.sha256) throw new Error(`${a.file}: sha256 ${sha} does not match the pinned ${a.sha256}`);
    await sb.files.upload(`/opt/val/${a.file}`, buf);
  }
  await sb.files.upload("/opt/val/validate.py", validatorSource());
  log("compiling the Peppol Schematron, writing the manifest, making the validator read-only");
  await sb.sh(
    "cd /opt/val && /opt/v/bin/python validate.py compile && " +
      "sha256sum *.xslt *.xsl *.sch *.xml validate.py > MANIFEST && " +
      "chown -R root:root /opt/val && chmod -R a-w,a+rX /opt/val && chmod -R a+rX,go-w /opt/v && mkdir -p /work && chmod 1777 /work",
    { label: "compile + manifest", timeoutMs: 120_000 },
  );
  const st = await selfTest(sb);
  log(`self-test ${st.ok ? "passed" : "FAILED"}: ${JSON.stringify(st.results)}`);
  if (!st.ok) throw new Error("validator self-test failed");
  await sb.setEgress(EGRESS_LOCK);
  log(`egress locked: ${EGRESS_LOCK.join(", ")}`);
  return st;
}

/** Replaces validate.py in a running golden VM (no network needed), re-seals the manifest and self-tests. */
export async function updateValidator(sb: Sandbox, log: Log = quiet): Promise<SelfTest> {
  await sb.sh("chmod u+w /opt/val", { label: "unseal" });
  await sb.sh("chmod u+w /opt/val/validate.py /opt/val/MANIFEST", { label: "unseal files" });
  await sb.files.upload("/opt/val/validate.py", validatorSource());
  await sb.sh(
    "cd /opt/val && sha256sum *.xslt *.xsl *.sch *.xml validate.py > MANIFEST && chown -R root:root /opt/val && chmod -R a-w,a+rX /opt/val && chmod -R a+rX,go-w /opt/v",
    { label: "reseal manifest" },
  );
  const st = await selfTest(sb);
  log(`validator updated; self-test ${st.ok ? "passed" : "FAILED"}: ${JSON.stringify(st.results)}`);
  if (!st.ok) throw new Error("validator self-test failed after update");
  return st;
}

export type SelfTest = { ok: boolean; results: Record<string, string[]> };

export async function selfTest(sb: Sandbox): Promise<SelfTest> {
  const r = await sb.runCommand("/opt/v/bin/python", ["/opt/val/validate.py", "selftest"], { timeoutMs: 120_000 });
  return JSON.parse(r.result.stdout) as SelfTest;
}

export async function prepareRun(sb: Sandbox, runId: string, files: Record<string, string>): Promise<void> {
  const id = safeRunId(runId);
  await sb.sh(`mkdir -p /work/${id} && chmod 777 /work/${id} && rm -f /work/${id}/out.xml`, { label: "run dir" });
  for (const [name, content] of Object.entries(files)) {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`bad file name ${name}`);
    await sb.files.upload(`/work/${id}/${name}`, content);
  }
}

export type MapRun = { exitCode: number; stdout: string; stderr: string; ms: number; networkBlocked: boolean };

const NETWORK_FAILURE =
  /Temporary failure in name resolution|Name or service not known|Network is unreachable|Connection refused|URLError|timed out|getaddrinfo/i;

export function looksLikeBlockedNetwork(stderr: string): boolean {
  return NETWORK_FAILURE.test(stderr);
}

/** Runs the model-written converter as `nobody`, 30 s limit, network off. */
export async function runMap(sb: Sandbox, runId: string): Promise<MapRun> {
  const id = safeRunId(runId);
  const t = Date.now();
  const r = await sb.runCommand(
    "sh",
    ["-c", `cd /work/${id} && timeout 30 runuser -u nobody -- /usr/bin/python3 map.py; rc=$?; pkill -9 -u nobody; exit $rc`],
    { timeoutMs: 60_000 },
  );
  const stderr = (r.result.stderr ?? "").slice(-4000);
  return {
    exitCode: r.result.exit_code,
    stdout: (r.result.stdout ?? "").slice(-2000),
    stderr,
    ms: Date.now() - t,
    networkBlocked: r.result.exit_code !== 0 && looksLikeBlockedNetwork(stderr),
  };
}

export type RuleFailure = { id: string; set: string; flag: string; message: string; location: string; test?: string };
export type Validation = {
  wellFormed: boolean;
  error?: string;
  failed: RuleFailure[];
  warnings: RuleFailure[];
  ms?: number;
};

/**
 * Runs the official rules on out.xml after checking the validator files against the bootstrap manifest. Every process
 * of `nobody` (map.py's user) is killed first so the file can't change mid-check; validate.py rejects any DOCTYPE.
 */
export async function validateRun(sb: Sandbox, runId: string): Promise<Validation> {
  const id = safeRunId(runId);
  const r = await sb.runCommand(
    "sh",
    ["-c", `cd /opt/val && { sha256sum --quiet -c MANIFEST || exit 3; } && { pkill -9 -u nobody; /opt/v/bin/python validate.py check /work/${id}/out.xml; }`],
    { timeoutMs: 90_000 },
  );
  if (r.result.exit_code === 3) throw new Error("validator refused to run: its files don't match the bootstrap manifest");
  if (r.result.exit_code !== 0) {
    // the official stylesheets can stop with a dynamic error on odd XML (a bad number, a wrong type): that is feedback for map.py
    const text = (r.result.stderr || r.result.stdout).trim();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => /error/i.test(l) && !/^(File |Traceback|at |invoked by)/.test(l));
    const why = at >= 0 ? lines.slice(at, at + 3).join(" | ").replace(/^saxonc\.PySaxonApiError: /, "") : (lines.slice(-1)[0] ?? "no message");
    return { wellFormed: false, error: `The official checker stopped on this XML: ${why.slice(0, 500)}`, failed: [], warnings: [] };
  }
  return JSON.parse(r.result.stdout) as Validation;
}

export async function readOutput(sb: Sandbox, runId: string): Promise<string | null> {
  try {
    const buf = await sb.files.download(`/work/${safeRunId(runId)}/out.xml`);
    return Buffer.from(buf).toString("utf8");
  } catch {
    return null;
  }
}

/** Asks the VM to reach the internet as `nobody`; with egress locked this must fail. */
export async function probeNetwork(sb: Sandbox): Promise<{ blocked: boolean; detail: string }> {
  const r = await sb.runCommand(
    "sh",
    [
      "-c",
      "timeout 12 runuser -u nobody -- /usr/bin/python3 -c \"import urllib.request; urllib.request.urlopen('https://pypi.org', timeout=8); print('REACHED')\" 2>&1 | tail -1",
    ],
    { timeoutMs: 30_000 },
  );
  const out = (r.result.stdout ?? "").trim();
  return { blocked: !out.includes("REACHED"), detail: out.slice(-200) };
}

export async function egressRules(sb: Sandbox): Promise<string[]> {
  const e = await sb.getEgress();
  return (e as { egress?: string[] }).egress ?? [];
}
