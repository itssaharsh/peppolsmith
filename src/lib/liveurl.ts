// The CreateOS live URL: the golden VM serves the certified converters over HTTPS ingress (vm/serve.py).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { recorded } from "./checks";
import { loadSource, SOURCE_KINDS } from "./sources";
import type { Log } from "./sandbox";

export const LIVE_PORT = 8787;

/** Installs the recorded certified converters, starts the server as nobody and turns ingress on. */
export async function publishConverters(sb: Sandbox, log: Log = () => {}): Promise<string> {
  const kinds: string[] = [];
  for (const kind of SOURCE_KINDS) {
    const rec = recorded(kind);
    if (!rec) continue;
    await sb.files.upload(`/srv/peppolsmith/${kind}/map.py`, rec.code);
    await sb.files.upload(`/srv/peppolsmith/${kind}/partners.json`, JSON.stringify(loadSource(kind).partners, null, 2));
    kinds.push(kind);
  }
  await sb.files.upload("/srv/peppolsmith/serve.py", readFileSync(path.join(process.cwd(), "vm", "serve.py"), "utf8"));
  await sb.sh("chown -R root:root /srv/peppolsmith && chmod -R a+rX,go-w /srv/peppolsmith", { label: "seal converters" });
  await sb.sh(
    `pkill -u nobody -f serve.py; sleep 0.5; setsid nohup runuser -u nobody -- /usr/bin/python3 /srv/peppolsmith/serve.py > /dev/null 2>&1 < /dev/null & sleep 1; curl -s localhost:${LIVE_PORT}/health`,
    { label: "start converter server" },
  );
  if (!sb.data.ingress_enabled) await sb.setIngress(true);
  const url = sb.previewUrl(LIVE_PORT);
  log(`converters ${kinds.join(", ")} served at ${url}`);
  return url;
}

/** The live URL if the VM has ingress on. */
export function liveUrlOf(sb: Sandbox): string | null {
  try {
    return sb.previewUrl(LIVE_PORT);
  } catch {
    return null;
  }
}
