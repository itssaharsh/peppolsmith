// POST /api/probe -> proves the network lock: from inside the VM, as the same unprivileged user that runs the AI's
// code, try to open https://pypi.org. With the host-side egress rule in place this must fail. No model call.
import { countCheck } from "@/lib/guard";
import { egressRules, probeNetwork, resumeGolden } from "@/lib/sandbox";

export const maxDuration = 60;

export async function POST() {
  try {
    const golden = await resumeGolden();
    if (!golden) return Response.json({ error: "The sandbox VM is not available." }, { status: 503 });
    if (!(await countCheck(golden.sandbox))) return Response.json({ error: "Today's check budget is used up." }, { status: 429 });
    const t0 = Date.now();
    const probe = await probeNetwork(golden.sandbox);
    const ms = Date.now() - t0;
    const egress = await egressRules(golden.sandbox).catch(() => []);
    return Response.json({ ...probe, ms, egress, resumeMs: golden.resumeMs, vmId: golden.sandbox.id, checkedAt: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: `The test failed to run: ${(e as Error).message.slice(0, 200)}` }, { status: 502 });
  }
}
