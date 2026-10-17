// One real call to each provider the stack depends on, using the .env written by Stripe Projects.
// Prints OK/FAIL per provider; never prints a key.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

type Check = { name: string; run: () => Promise<string> };

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run: stripe projects env --pull)`);
  return v;
};

const checks: Check[] = [
  {
    name: "CreateOS Sandbox API (key from stripe projects add createos/project)",
    run: async () => {
      const res = await fetch("https://api.sb.createos.sh/v1/whoami", {
        headers: { "X-Api-Key": need("CREATEOS_PROJECT_API_KEY") },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { stats?: Record<string, number> } };
      return `sandboxes ${JSON.stringify(body.data?.stats ?? {})}`;
    },
  },
  {
    name: "Featherless (model provider, key stored as a Stripe Projects variable)",
    run: async () => {
      const res = await fetch("https://api.featherless.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${need("FEATHERLESS_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply with the single word OK." }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      return `reply "${body.choices[0]?.message?.content?.trim()}"`;
    },
  },
  {
    name: "OpenRouter (fallback models, key from stripe projects add openrouter/api)",
    run: async () => {
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${need("OPENROUTER_API_API_KEY")}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { is_free_tier?: boolean; usage?: number } };
      return `free tier ${body.data?.is_free_tier}, usage ${body.data?.usage}`;
    },
  },
];

async function main() {
  let failed = 0;
  for (const c of checks) {
    try {
      console.log(`OK   ${c.name}: ${await c.run()}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}: ${(e as Error).message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();
