// POST /api/step {run} -> the same run log with one more attempt (write -> run in the VM -> official rules -> gates).
import { stepRun } from "@/lib/run";
import { MAX_ATTEMPTS } from "@/lib/agent";
import { isSourceKind } from "@/lib/sources";
import { resumeGolden } from "@/lib/sandbox";
import { releaseRun, touchRun } from "@/lib/guard";
import type { RunLog } from "@/lib/runlog";
import { signRun, verifyRun } from "@/lib/sign";

export const maxDuration = 300;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 400_000) return Response.json({ error: "Run log too large." }, { status: 413 });
  let run: RunLog;
  try {
    run = (JSON.parse(text) as { run: RunLog }).run;
  } catch {
    return Response.json({ error: "Not a run log." }, { status: 400 });
  }
  if (!run || !/^run-[a-f0-9]{10}$/.test(run.runId) || !isSourceKind(run.source?.kind) || !Array.isArray(run.attempts) || run.attempts.length >= MAX_ATTEMPTS) {
    return Response.json({ error: "Not a run this server can continue." }, { status: 400 });
  }
  if (!verifyRun(run)) return Response.json({ error: "This run log wasn't issued by this server, or it was changed." }, { status: 403 });
  try {
    const golden = (await resumeGolden())?.sandbox;
    if (!golden) return Response.json({ error: "The sandbox VM is not available." }, { status: 503 });
    run = { ...run, sandbox: { ...run.sandbox, vmId: golden.id } }; // never trust a client-supplied VM id
    if (!(await touchRun(golden, run.runId))) return Response.json({ error: "Another live run holds the sandbox.", reason: "busy" }, { status: 409 });
    const next = await stepRun(run);
    if (next.verdict !== "running") await releaseRun(golden, run.runId);
    return Response.json(signRun(next));
  } catch (e) {
    return Response.json({ error: `The attempt failed: ${(e as Error).message}` }, { status: 502 });
  }
}
