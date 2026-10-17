// POST /api/run {source: "stripe" | "cii" | "csv"} -> a new live run log (or 409 busy / 429 daily cap).
import { startRun } from "@/lib/run";
import { isSourceKind } from "@/lib/sources";
import { acquireRun } from "@/lib/guard";
import { client } from "@/lib/sandbox";
import { signRun } from "@/lib/sign";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  if (!isSourceKind(body.source)) return Response.json({ error: "Pick one of the three sample sources." }, { status: 400 });
  try {
    const run = await startRun(body.source);
    const sb = await client().getSandbox(run.sandbox.vmId);
    const lock = await acquireRun(sb, run.runId);
    if (!lock.ok) {
      const message = lock.reason === "busy" ? "Someone else's live run is going. The replay shows a full run meanwhile." : "Today's live-run budget is used up. The replay shows a full run.";
      return Response.json({ error: message, reason: lock.reason }, { status: lock.reason === "busy" ? 409 : 429 });
    }
    return Response.json(signRun(run));
  } catch (e) {
    return Response.json({ error: `Couldn't start the run: ${(e as Error).message}` }, { status: 502 });
  }
}
