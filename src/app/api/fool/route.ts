// POST /api/fool {source, mutation} -> plants one converter bug in the recorded certified XML and runs all three
// checks again. Not a model run: it shows what the release gates do with XML that passes the official rules.
import { fool, isMutation, MUTATIONS, recorded } from "@/lib/checks";
import { isSourceKind, loadSource } from "@/lib/sources";
import { newRunId } from "@/lib/run";
import { resumeGolden } from "@/lib/sandbox";
import { countCheck } from "@/lib/guard";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { source?: unknown; mutation?: unknown };
  if (!isSourceKind(body.source) || !isMutation(body.mutation)) return Response.json({ error: "Pick a source and one of the three planted bugs." }, { status: 400 });
  const rec = recorded(body.source);
  if (!rec) return Response.json({ error: "Needs a certified result first." }, { status: 409 });
  try {
    const golden = await resumeGolden();
    if (!golden) return Response.json({ error: "The sandbox VM is not available." }, { status: 503 });
    if (!(await countCheck(golden.sandbox))) return Response.json({ error: "Today's check budget is used up. The recorded results still show." }, { status: 429 });
    const result = await fool(golden.sandbox, newRunId(), loadSource(body.source), rec.xml, body.mutation);
    return Response.json({ mutation: body.mutation, label: MUTATIONS[body.mutation], ...result });
  } catch (e) {
    return Response.json({ error: `The check failed: ${(e as Error).message}` }, { status: 502 });
  }
}
