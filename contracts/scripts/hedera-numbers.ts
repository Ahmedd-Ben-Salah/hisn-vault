import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { artifact, need, ROOT, MIRROR_URL, sleep } from "./lib/env";
import { Interface } from "ethers";

async function get<T = any>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(path.startsWith("http") ? path : `${MIRROR_URL}${path}`);
    if (r.ok) return (await r.json()) as T;
    if (i >= 4) throw new Error(`mirror ${r.status} ${path}`);
    await sleep(1500 * (i + 1));
  }
}

async function all<T>(path: string, key: string, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next && out.length < max) {
    const body: any = await get(next);
    out.push(...(body[key] ?? []));
    next = body.links?.next ? `${MIRROR_URL}${body.links.next}` : null;
  }
  return out;
}

async function main() {
  const vaultId = need("VAULT_ID");
  const topic = need("HCS_TOPIC_ID");
  const iface = new Interface(artifact("HisnVault").abi);
  const rate = (await get("/api/v1/network/exchangerate")).current_rate;
  const usdPerTinybar = rate.cent_equivalent / rate.hbar_equivalent / 100 / 1e8;
  const usd = (tinybar: number) => tinybar * usdPerTinybar;

  const results = await all<any>(`/api/v1/contracts/${vaultId}/results?limit=100&order=asc`, "results");
  const calls: { name: string; fee: number; scheduled: boolean; gas: number }[] = [];
  for (const r of results) {
    let name = "deploy";
    if (!r.created_contract_ids?.length) {
      try {
        name = iface.parseTransaction({ data: r.function_parameters })?.name ?? "unknown";
      } catch {
        name = Number(r.amount) > 0 ? "deposit" : "unknown";
      }
    }
    const tx = (await get(`/api/v1/transactions?timestamp=${r.timestamp}`)).transactions?.[0];
    calls.push({ name, fee: Number(tx?.charged_tx_fee ?? 0), scheduled: !!tx?.scheduled, gas: Number(r.gas_used ?? 0) });
  }

  const relayerId = need("RELAYER_ACCOUNT_ID");
  const schedules = (await all<any>(`/api/v1/schedules?account.id=${relayerId}&limit=100&order=asc`, "schedules")).filter((x) => x.payer_account_id === vaultId);
  for (const sch of schedules) {
    if (!sch.executed_timestamp) continue;
    const tx = (await get(`/api/v1/transactions?timestamp=${sch.executed_timestamp}`)).transactions?.[0];
    calls.push({ name: "execute", fee: Number(tx?.charged_tx_fee ?? 0), scheduled: !!tx?.scheduled, gas: 0 });
  }

  const msgs = await all<any>(`/api/v1/topics/${topic}/messages?limit=100&order=asc`, "messages");
  const sample = msgs.slice(-8);
  let msgFee = 0;
  for (const m of sample) {
    const tx = (await get(`/api/v1/transactions?timestamp=${m.consensus_timestamp}`)).transactions?.[0];
    msgFee += Number(tx?.charged_tx_fee ?? 0);
  }
  msgFee = sample.length ? msgFee / sample.length : 0;
  const byType = new Map<string, number>();
  const byRef = new Map<number, number>();
  for (const m of msgs) {
    try {
      const j = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
      byType.set(j.type, (byType.get(j.type) ?? 0) + 1);
      if (j.ref) byRef.set(Number(j.ref), (byRef.get(Number(j.ref)) ?? 0) + 1);
    } catch {
      byType.set("other", (byType.get("other") ?? 0) + 1);
    }
  }

  const groups = new Map<string, { n: number; fee: number; scheduled: number; gas: number }>();
  for (const c of calls) {
    const k = c.name === "execute" && c.scheduled ? "execute (by the network)" : c.name;
    const g = groups.get(k) ?? { n: 0, fee: 0, scheduled: 0, gas: 0 };
    g.n++;
    g.fee += c.fee;
    g.gas += c.gas;
    if (c.scheduled) g.scheduled++;
    groups.set(k, g);
  }
  const avg = (k: string) => {
    const g = groups.get(k);
    return g ? g.fee / g.n : 0;
  };
  const refCounts = [...byRef.values()];
  const msgsPerPayment = refCounts.length ? refCounts.reduce((a, b) => a + b, 0) / refCounts.length : 0;
  const scheduledRuns = calls.filter((c) => c.scheduled).length;
  const waitPayment = avg("propose") + avg("reconfirm") + (avg("execute (by the network)") || avg("execute")) + msgsPerPayment * msgFee;
  const fmt = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

  const lines = [
    "# Hedera numbers from our testnet runs",
    "",
    `Vault \`${vaultId}\`, public log \`${topic}\`, read from the mirror node on ${new Date().toISOString()}. Dollar values use Hedera's published exchange rate at that time (${(rate.cent_equivalent / rate.hbar_equivalent / 100).toFixed(4)} USD per HBAR). Testnet fees mirror mainnet's fee schedule.`,
    "",
    "## One protected payment that waits, then is released by the network",
    "",
    "| Step | Hedera service | Average fee |",
    "|---|---|---|",
    `| Puck-signed proposal | Smart contract call | ${fmt(usd(avg("propose")))} |`,
    `| Puck-signed second confirmation, which books the release | Smart contract call + Schedule Service | ${fmt(usd(avg("reconfirm")))} |`,
    `| Release at the chosen second, run by the network and paid by the vault | Scheduled transaction | ${fmt(usd(avg("execute (by the network)") || avg("execute")))} |`,
    `| About ${msgsPerPayment.toFixed(1)} signed entries in the public log | Consensus Service | ${fmt(usd(msgsPerPayment * msgFee))} |`,
    `| **Total** | | **${fmt(usd(waitPayment))}** |`,
    "",
    "## Everything this vault has done so far",
    "",
    "| Call | Count | Average fee | Average gas |",
    "|---|---|---|---|",
    ...[...groups.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `| ${k} | ${g.n} | ${fmt(usd(g.fee / g.n))} | ${g.gas ? Math.round(g.gas / g.n).toLocaleString("en-US") : "n/a"} |`),
    "",
    `- Contract transactions: **${calls.length}**, of which **${scheduledRuns}** were executed by the network on its own schedule, paid from the vault's own HBAR reserve.`,
    `- Schedules created by the vault: **${schedules.length}** (${schedules.filter((x) => x.executed_timestamp).length} executed, ${schedules.filter((x) => x.deleted).length} deleted after a stop or freeze).`,
    `- Public-log messages: **${msgs.length}** (${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}). Average fee per message ${fmt(usd(msgFee))}.`,
    "",
  ];
  writeFileSync(resolve(ROOT, "docs", "HEDERA_NUMBERS.md"), lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
