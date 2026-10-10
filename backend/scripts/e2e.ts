import { Wallet } from "ethers";
import { config } from "../src/config.js";
import type { PaymentView, RequestView, TimelineEntry, StateView, ChangeView } from "../src/shared.js";

const API = `http://127.0.0.1:${config.port}`;
const SIM = `http://127.0.0.1:${process.env.SIM_PORT ?? 8790}`;
const HBAR_MODE = process.env.E2E_TOKEN === "HBAR";
const USDC = HBAR_MODE ? "0x0000000000000000000000000000000000000000" : config.usdc;
const U = HBAR_MODE ? (n: number) => String(BigInt(Math.round(n * 100)) * 1_000_000n) : (n: number) => String(BigInt(n) * 1_000_000n);
const AMT = HBAR_MODE ? { instant: 0.5, wait: 2, veto: 3, freeze: 1 } : { instant: 10, wait: 100, veto: 120, freeze: 50 };
const [sami] = (process.env.PAYEE_ADDRESSES ?? "").split(",");
const stranger = process.env.STRANGER_ADDRESS!;
const WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 120_000);

let failures = 0;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`${path}: ${(out as { error: string }).error}`);
  return out as T;
}

async function sim(path: string): Promise<string> {
  const r = await fetch(`${SIM}${path}`, { method: "POST" });
  return ((await r.json()) as { result: string }).result;
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = WAIT_MS): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function pay(to: string, amount: string): Promise<PaymentView> {
  const { reqId, tier } = await api<{ reqId: number; tier: string }>("/requests", { to, token: USDC, amount, source: "dashboard" });
  await until("puck to see request", async () => (await sim(`/puck/sign/${reqId}`)).startsWith("signed"), WAIT_MS);
  const r = await until("proposal", async () => {
    const x = await api<RequestView>(`/requests/${reqId}`);
    if (x.status === "failed") throw new Error(x.reason);
    return x.status === "proposed" ? x : null;
  });
  const p = await until("indexer", async () => (await api<PaymentView[]>("/payments")).find((x) => x.id === r.paymentId && (x.status !== "EXECUTED" || x.executedBy)));
  console.log(`      payment ${p.id}: preview ${tier}, vault said ${p.tier}`);
  check(tier === p.tier, `tier preview matches vault for ${amount} to ${to.slice(0, 8)}`);
  return p;
}

async function payment(id: number): Promise<PaymentView> {
  return api<PaymentView>(`/payments/${id}`);
}

async function main() {
  for (const p of await api<PaymentView[]>("/payments")) {
    if (p.status === "PENDING") console.log(`      clearing leftover payment ${p.id}: ${await sim(`/puck/cancel/${p.id}`)}`);
  }
  await until("leftovers cleared", async () => !(await api<PaymentView[]>("/payments")).some((p) => p.status === "PENDING"));
  console.log("1. instant payment to a saved payee");
  const p1 = await pay(sami, U(AMT.instant));
  check(p1.tier === "INSTANT" && p1.status === "EXECUTED", "instant payment executed in the same transaction");
  check(p1.executedBy === "vault", `executedBy is vault (got ${p1.executedBy})`);

  console.log("2. wait payment, second confirmation, network release");
  const p2 = await pay(stranger, U(AMT.wait));
  check(p2.tier === "WAIT" && p2.status === "PENDING" && p2.newRecipient, "new-recipient payment waits");

  console.log("3. veto by the guardian light");
  const p3 = await pay(stranger, U(AMT.veto));
  console.log(`      ${await sim(`/guardian/stop/${p3.id}?who=watcher`)}`);
  const v3 = await until("veto", async () => {
    const x = await payment(p3.id);
    return x.status === "VETOED" ? x : null;
  }, WAIT_MS);
  check(v3.status === "VETOED" && !!v3.txs.vetoed, "light veto stopped the payment");

  console.log("4. large payment needs a guardian");
  const st = await api<StateView>("/state");
  const bal = BigInt(HBAR_MODE ? st.balances.hbar : st.balances.usdc);
  const spendable = HBAR_MODE ? bal - BigInt(st.gasReserve) : bal;
  const big = String((spendable * 6n) / 10n);
  const p4 = await pay(stranger, big);
  check(p4.tier === "APPROVAL", "large payment to a new recipient needs approval");
  console.log(`      ${await sim(`/guardian/approve/${p4.id}`)}`);
  const a4 = await until("approval", async () => {
    const x = await payment(p4.id);
    return x.confirmed ? x : null;
  }, WAIT_MS);
  check(!!a4.schedule, `approval created a network schedule ${a4.schedule}`);

  console.log("5. settings change through the puck");
  const cr = await api<{ reqId: number }>("/changes/request", { kind: "ADD_PAYEE", fields: { address: Wallet.createRandom().address } });
  await until("puck change", async () => (await sim(`/puck/change/${cr.reqId}`)).startsWith("signed"), WAIT_MS);
  const done = await until("change proposed", async () => {
    const x = await api<{ status: string; changeId?: number; reason?: string }>(`/changes/request/${cr.reqId}`);
    if (x.status === "failed" || x.status === "rejected") throw new Error(x.reason);
    return x.status === "proposed" && x.changeId ? x : null;
  });
  const ch = await until("change", async () => (await api<ChangeView[]>("/changes")).find((c) => c.id === done.changeId));
  check(ch.status === "PENDING" && ch.needsApproval, `ADD_PAYEE change ${ch.id} waiting`);
  console.log(`      ${await sim(`/change/approve/${ch.id}`)}`);
  const ch2 = await until("change approve", async () => (await api<ChangeView[]>("/changes")).find((c) => c.id === ch.id && c.approver));
  check(!!ch2.approver, "guardian approved the change");
  const early = await api(`/relay/change/${ch.id}/execute`, {}).then(() => "applied", (e: Error) => e.message);
  check(early.includes("NotReady"), `applying before the delay is refused (${early})`);

  console.log("   waiting for the second-confirmation window of payment", p2.id);
  const now = Math.floor(Date.now() / 1000);
  await new Promise((r) => setTimeout(r, Math.max(0, p2.confirmFrom - now + 3) * 1000));
  console.log(`      ${await sim(`/puck/reconfirm/${p2.id}`)}`);
  const c2 = await until("reconfirm", async () => {
    const x = await payment(p2.id);
    return x.confirmed ? x : null;
  }, WAIT_MS);
  check(!!c2.schedule, `reconfirm scheduled the release ${c2.schedule}`);

  console.log("   waiting for the network to release payments", p2.id, "and", p4.id);
  const e2 = await until("network release", async () => {
    const x = await payment(p2.id);
    return x.status === "EXECUTED" ? x : null;
  }, WAIT_MS * 2);
  check(e2.executedBy === "network", `payment ${p2.id} released by the network (got ${e2.executedBy})`);
  const e4 = await until("network release", async () => {
    const x = await payment(p4.id);
    return x.status === "EXECUTED" ? x : null;
  }, WAIT_MS * 2);
  check(e4.executedBy === "network", `payment ${p4.id} released by the network (got ${e4.executedBy})`);

  const tl = await api<TimelineEntry[]>(`/payments/${p2.id}/timeline`);
  const names = tl.map((e) => `${e.name}${e.verified ? "" : "?"}`);
  console.log(`      timeline: ${names.join(" > ")}`);
  for (const n of ["PAY_SIGNED", "PROPOSED", "ALERT_ACK", "RECONFIRM_SIGNED", "RELEASED"]) {
    check(tl.some((e) => e.kind === "hcs" && e.name === n && e.verified), `timeline has verified ${n}`);
  }
  check(tl.some((e) => e.kind === "event" && e.name === "Executed"), "timeline has the Executed event");

  console.log("6. freeze cancels waiting payments");
  const p6 = await pay(stranger, U(AMT.freeze));
  console.log(`      ${await sim("/freeze?who=watcher")}`);
  const s6 = await until("freeze", async () => {
    const s = await api<StateView>("/state");
    return s.frozen ? s : null;
  }, WAIT_MS);
  check(s6.frozen, "vault is frozen");
  const x6 = await until("cancel", async () => {
    const x = await payment(p6.id);
    return x.status === "CANCELLED" ? x : null;
  }, WAIT_MS);
  check(x6.status === "CANCELLED", "waiting payment cancelled by the freeze");
  const refused = await api("/requests", { to: sami, token: USDC, amount: U(1), source: "dashboard" }).then(() => "accepted", (e: Error) => e.message);
  check(refused.includes("frozen"), "new requests refused while frozen");
  const changes = await api<ChangeView[]>("/changes");
  check(changes.find((c) => c.id === ch.id)?.status === "EXPIRED", "freeze killed the waiting change");

  const log = await api<TimelineEntry[]>("/log?limit=200");
  check(log.length > 20 && log.filter((e) => e.kind === "hcs").every((e) => e.verified || e.name === "REQUEST"), `public log has ${log.length} entries, all verified except REQUEST notes`);
  const ev = await api<{ hcsMessages: unknown[]; contractEvents: unknown[] }>(`/export/${p2.id}`);
  check(ev.hcsMessages.length >= 5 && ev.contractEvents.length >= 3, "evidence export has messages and events");

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E ERROR:", e.message);
  process.exit(1);
});
