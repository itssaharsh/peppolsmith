// POST /api/convert {source} -> runs the recorded certified map.py on a second invoice of the same kind,
// in the VM with the network off, then the three checks. No model call.
import { convert, recorded } from "@/lib/checks";
import { hasSecond, isSourceKind, loadSource } from "@/lib/sources";
import { newRunId } from "@/lib/run";
import { resumeGolden } from "@/lib/sandbox";
import { countCheck } from "@/lib/guard";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { source?: unknown };
  if (!isSourceKind(body.source)) return Response.json({ error: "Pick one of the three sample sources." }, { status: 400 });
  if (!hasSecond(body.source)) return Response.json({ error: "No second invoice of this kind is bundled, so there is nothing new to convert." }, { status: 404 });
  const rec = recorded(body.source);
  if (!rec) return Response.json({ error: "Needs a certified converter first." }, { status: 409 });
  try {
    const golden = await resumeGolden();
    if (!golden) return Response.json({ error: "The sandbox VM is not available." }, { status: 503 });
    if (!(await countCheck(golden.sandbox))) return Response.json({ error: "Today's check budget is used up. The recorded results still show." }, { status: 429 });
    const source = loadSource(body.source, "second");
    const result = await convert(golden.sandbox, newRunId(), source, rec.code);
    return Response.json({ invoiceRef: source.ref, label: source.label, modelCalls: 0, converterFrom: rec.runId, ...result });
  } catch (e) {
    return Response.json({ error: `The conversion failed: ${(e as Error).message}` }, { status: 502 });
  }
}
