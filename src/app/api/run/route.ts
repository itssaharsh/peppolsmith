// POST /api/run {source: "stripe" | "cii" | "csv"} -> a new live run log (or 409 busy / 429 daily cap).
import { startRun } from "@/lib/run";
import { isSourceKind, sourceFromUpload } from "@/lib/sources";
import { acquireRun, lockBusy } from "@/lib/guard";
import { client, resumeGolden } from "@/lib/sandbox";
import { signRun } from "@/lib/sign";
import { sourceFromPdf } from "@/lib/pdf";

export const maxDuration = 300;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 2_900_000) return Response.json({ error: "The file is too large: send one invoice (a PDF up to 2 MB, other files up to 100 KB)." }, { status: 413 });
  let body: { source?: unknown; upload?: unknown; pdf?: unknown };
  try {
    body = JSON.parse(text) as { source?: unknown; upload?: unknown; pdf?: unknown };
  } catch {
    body = {};
  }
  if (typeof body.pdf === "string") {
    // a PDF: the AI reads it, checks with no AI verify the reading, then it runs like any other upload.
    // Check the lock first, so a PDF uploaded during someone else's run doesn't spend a model call to be told "busy".
    try {
      const golden = await resumeGolden();
      if (golden && (await lockBusy(golden.sandbox))) {
        return Response.json({ error: "Someone else's live run is going. The replay shows a full run meanwhile.", reason: "busy" }, { status: 409 });
      }
    } catch {
      /* acquireRun below still decides */
    }
    let prepared: Awaited<ReturnType<typeof sourceFromPdf>>;
    try {
      prepared = await sourceFromPdf(new Uint8Array(Buffer.from(body.pdf, "base64")));
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    try {
      const run = await startRun(prepared.source.kind, undefined, undefined, prepared);
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
  const upload = typeof body.upload === "string" ? body.upload : undefined;
  if (upload === undefined && !isSourceKind(body.source)) return Response.json({ error: "Upload an invoice or pick one of the samples." }, { status: 400 });
  if (upload !== undefined) {
    try {
      sourceFromUpload(upload); // readable 400 before any VM or model work
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  try {
    const run = await startRun(isSourceKind(body.source) ? body.source : "stripe", undefined, upload);
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
