// POST /api/release {runId, token} -> frees the live-run lock when its tab closes or the visitor presses Stop,
// so the next visitor doesn't wait for the lock to go stale. Sent with navigator.sendBeacon.
import { releaseRun } from "@/lib/guard";
import { findGolden } from "@/lib/sandbox";
import { verifyRelease } from "@/lib/sign";

export async function POST(request: Request) {
  const body = (JSON.parse((await request.text().catch(() => "")) || "{}") ?? {}) as { runId?: unknown; token?: unknown };
  const runId = typeof body.runId === "string" && /^run-[a-f0-9]{10}$/.test(body.runId) ? body.runId : null;
  if (!runId || !verifyRelease(runId, body.token)) return Response.json({ error: "Not a run this server issued." }, { status: 403 });
  try {
    const sb = await findGolden();
    if (sb && sb.status === "running") await releaseRun(sb, runId); // only removes LOCK if this run holds it
    return Response.json({ released: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
