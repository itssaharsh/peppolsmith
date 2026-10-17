// GET /api/health -> the golden VM's state and the live-run lock, read from the VM itself.
import { findGolden } from "@/lib/sandbox";
import { DAILY_LIVE_RUNS } from "@/lib/guard";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const sb = await findGolden();
    if (!sb) return Response.json({ vmId: null, vmStatus: "missing", busy: false, runsToday: 0, dailyCap: DAILY_LIVE_RUNS, checkedAt });
    let busy = false;
    let runsToday = 0;
    if (sb.status === "running") {
      const r = await sb.sh(
        'cd /work 2>/dev/null && day=$(date -u +%Y%m%d); n=$(cat runs-$day 2>/dev/null || echo 0); if [ -f LOCK ] && [ $(( $(date +%s) - $(stat -c %Y LOCK) )) -lt 180 ]; then echo "$n BUSY"; else echo "$n FREE"; fi',
        { label: "health" },
      );
      const [n, state] = r.result.stdout.trim().split(" ");
      runsToday = Number(n) || 0;
      busy = state === "BUSY";
    }
    return Response.json({ vmId: sb.id, vmStatus: sb.status, busy, runsToday, dailyCap: DAILY_LIVE_RUNS, checkedAt });
  } catch (e) {
    return Response.json({ error: (e as Error).message, checkedAt }, { status: 502 });
  }
}
