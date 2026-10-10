import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatAmount, hashscanAccount, hashscanContract, hashscanSchedule, hashscanTopic, type HcsType } from "@hisn/shared";
import {
  Mirror,
  TIER,
  agentPayments,
  buildStories,
  consensusDate,
  readEvents,
  readRelease,
  readRules,
  readTopic,
  resolve,
  txLink,
  wanted,
  type AgentPayment,
  type LogLine,
  type Release,
  type Rules,
  type Source,
  type Step,
  type Story,
} from "./mirror";

interface Data {
  source: Source;
  rules: Rules;
  stories: Story[];
  releases: Record<number, Release | null>;
  helper: AgentPayment[];
  log: LogLine[];
  readAt: Date;
}

async function load(search: string): Promise<Data> {
  const source = await resolve(wanted(search));
  const m = new Mirror(source.mirror);
  const [rules, events, log] = await Promise.all([readRules(m, source), readEvents(m, source), readTopic(m, source)]);
  const stories = buildStories(events, log, rules.guardians);
  const released = await Promise.all(stories.map(async (s) => [s.id, await readRelease(m, s).catch(() => null)] as const));
  return { source, rules, stories, releases: Object.fromEntries(released), helper: agentPayments(events), log, readAt: new Date() };
}

function money(amount: bigint, token: string, rules: Rules): string {
  const t = rules.tokens.find((x) => x.address.toLowerCase() === token.toLowerCase());
  const s = formatAmount(amount, t?.decimals ?? 6, 2);
  const [w, f] = s.split(".");
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f} ${t?.symbol ?? "tokens"}`;
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function nameOf(a: string | undefined, r: Rules): string {
  if (!a) return "";
  const x = a.toLowerCase();
  if (x === r.puck.toLowerCase()) return "the puck";
  const g = r.guardians.findIndex((y) => y.toLowerCase() === x);
  if (g >= 0) return `guardian ${g + 1}`;
  if (r.watchers.some((y) => y.toLowerCase() === x)) return "the alarm light";
  if (x === r.agent.toLowerCase()) return "the helper";
  if (r.payees.some((y) => y.toLowerCase() === x)) return "a saved name";
  return "";
}

function who(a: string, r: Rules): string {
  return nameOf(a, r) || short(a);
}

function Named({ a, r }: { a: string; r: Rules }) {
  const n = nameOf(a, r);
  return (
    <span>
      to <Addr a={a} />
      {n && <span className="text-ink-soft"> ({n})</span>}
    </span>
  );
}

function span(seconds: number): string {
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function when(at: string): string {
  return consensusDate(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-bold text-door underline decoration-door/40 underline-offset-2 hover:decoration-door">
      {children}
    </a>
  );
}

function Addr({ a }: { a: string }) {
  return (
    <a href={hashscanAccount(a)} target="_blank" rel="noreferrer" title={a} className="font-mono text-[0.92em] text-door underline decoration-door/30 underline-offset-2">
      {short(a)}
    </a>
  );
}

function Panel({ title, raw, children }: { title: string; raw?: string; children: ReactNode }) {
  return (
    <section className="arrive rounded-2xl bg-paper p-5 shadow-[0_10px_30px_-18px_rgba(20,33,61,0.45)] sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-wide text-2xl font-[800]">{title}</h2>
        {raw && (
          <a href={raw} target="_blank" rel="noreferrer" className="text-sm font-bold text-ink-soft underline underline-offset-2">
            Raw data from the mirror node
          </a>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Proof({ d }: { d: Data }) {
  const released = d.stories.filter((s) => s.outcome === "executed" && s.tier !== TIER.INSTANT);
  const byNetwork = released.filter((s) => d.releases[s.id]?.scheduled);
  const latest = byNetwork[0];
  const rel = latest ? d.releases[latest.id] : null;
  return (
    <section className="arrive overflow-hidden rounded-2xl bg-ink text-paper shadow-[0_18px_40px_-20px_rgba(20,33,61,0.8)]">
      <div className="h-2 bg-safe" aria-hidden="true" />
      <div className="p-5 sm:p-7">
        <p className="font-display text-sm font-bold tracking-[0.18em] text-paper/70 uppercase">Who pressed the button?</p>
        <p className="mt-2 font-wide text-[1.9rem] leading-tight font-[800] sm:text-4xl">
          {released.length === 0
            ? "No held payment has been released yet."
            : byNetwork.length === released.length
              ? `All ${released.length} held payment${released.length === 1 ? " was" : "s were"} released by Hedera itself.`
              : `${byNetwork.length} of ${released.length} held payments were released by Hedera itself.`}
        </p>
        <p className="mt-3 max-w-2xl text-lg text-paper/85">
          When the owner confirms, the vault books a scheduled transaction with Hedera. At the release time the network runs it, paid by the vault's own
          account. Nobody from Hisn sends anything at that moment, and the server can be switched off.
        </p>
        {latest && rel && (
          <dl className="mt-5 grid gap-x-6 gap-y-2 rounded-xl bg-paper/8 p-4 text-[0.98rem] sm:grid-cols-[auto_1fr]">
            <dt className="text-paper/70">Latest one</dt>
            <dd>
              Payment {latest.id}, {money(latest.amount, latest.token, d.rules)}
            </dd>
            {latest.schedule && (
              <>
                <dt className="text-paper/70">Schedule</dt>
                <dd>
                  <a className="font-bold underline" href={hashscanSchedule(latest.schedule)} target="_blank" rel="noreferrer">
                    {latest.schedule}
                  </a>
                  {rel.scheduleExecuted && <>, executed at {when(rel.scheduleExecuted)}</>}
                </dd>
              </>
            )}
            <dt className="text-paper/70">Release transaction</dt>
            <dd className="break-all">
              <a className="font-bold underline" href={txLink(latest.executedAt ?? rel.txId)} target="_blank" rel="noreferrer">
                {rel.txId}
              </a>
            </dd>
            <dt className="text-paper/70">What the network says</dt>
            <dd className="font-mono">
              scheduled = {String(rel.scheduled)}, result = {rel.result}
              {rel.payer && `, paid by ${rel.payer}${rel.payer === d.source.vaultId ? " (the vault)" : ""}`}
            </dd>
            <dt className="text-paper/70">Check with no page at all</dt>
            <dd className="space-y-1 font-mono text-sm break-all">
              {latest.schedule && (
                <a className="block underline" href={`${d.source.mirror}/api/v1/schedules/${latest.schedule}`} target="_blank" rel="noreferrer">
                  {d.source.mirror}/api/v1/schedules/{latest.schedule}
                </a>
              )}
              <a className="block underline" href={`${d.source.mirror}/api/v1/transactions?timestamp=${latest.executedAt}`} target="_blank" rel="noreferrer">
                {d.source.mirror}/api/v1/transactions?timestamp={latest.executedAt}
              </a>
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}

function Rule({ label, children, how }: { label: string; children: ReactNode; how: string }) {
  return (
    <div className="border-t border-line py-3 sm:grid sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="font-bold">{label}</dt>
      <dd>
        <div>{children}</div>
        <div className="mt-0.5 font-mono text-xs text-ink-soft">{how}</div>
      </dd>
    </div>
  );
}

function RulesPanel({ d }: { d: Data }) {
  const r = d.rules;
  const now = Date.now() / 1000;
  const list = (xs: string[]) =>
    xs.length === 0 ? (
      "none"
    ) : (
      <span className="flex flex-wrap gap-x-3">
        {xs.map((x) => (
          <Addr key={x} a={x} />
        ))}
      </span>
    );
  return (
    <Panel title="The rules the vault enforces" raw={`${d.source.mirror}/api/v1/contracts/${d.source.vaultId}`}>
      <p className="mb-3 text-ink-soft">Read from the vault contract itself. The Hisn server cannot change any of these. Each change needs the puck, then a wait, and a guardian can stop it.</p>
      <dl>
        <Rule label="Account" how="vault contract">
          <Ext href={hashscanContract(d.source.vault)}>{d.source.vaultId}</Ext>{" "}
          {r.frozenUntil > now ? <strong className="text-ice">Frozen until {new Date(r.frozenUntil * 1000).toLocaleTimeString()}</strong> : <span className="text-safe">Open</span>}
        </Rule>
        {r.tokens.map((t) => (
          <Rule key={t.address} label={`${t.symbol} limits`} how={`limits(${t.address === "0x0000000000000000000000000000000000000000" ? "HBAR" : short(t.address)})`}>
            <strong className="tabular">{money(t.balance, t.address, r)}</strong> in the vault.
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              <li>
                To a saved name: leaves at once up to {money(t.instantMax, t.address, r)} each, {money(t.dailyCap, t.address, r)} in total over today and yesterday.
              </li>
              <li>Anything else is held for the cool-off and needs a second yes on the puck, up to {money(t.waitMax, t.address, r)} held over today and yesterday.</li>
              <li>Beyond that, or more than half the balance to a name never paid before, it needs a guardian's yes.</li>
              <li>The helper: {money(t.agentDailyMax, t.address, r)} over today and yesterday.</li>
            </ul>
          </Rule>
        ))}
        <Rule label="Cool-off" how="coolOff(), MIN_COOLOFF()">
          {span(r.coolOff)} between the second yes and the money leaving. It can never go below {span(r.minCoolOff)}.
        </Rule>
        <Rule label="The puck" how="puck()">
          <Addr a={r.puck} />, the only key that can send money or ask for a rule change.
        </Rule>
        <Rule label="Guardians" how="getGuardians()">
          {list(r.guardians)}
          <span className="block text-ink-soft">Can stop a payment, approve a large one, or freeze the account for {span(r.freezeMax)}.</span>
        </Rule>
        <Rule label="Alarm lights" how="getWatchers()">
          {list(r.watchers)}
          <span className="block text-ink-soft">Can stop and freeze, never approve.</span>
        </Rule>
        <Rule label="The helper" how="agent()">
          <Addr a={r.agent} />, capped by the vault, not by its own code.
        </Rule>
        <Rule label="Saved names" how="getPayees()">
          {list(r.payees)}
        </Rule>
        <Rule label="Waits for changes" how="SETTINGS_DELAY(), RECOVERY_DELAY(), APPROVAL_WINDOW()">
          Rule changes wait {span(r.settingsDelay)}. Replacing a lost puck waits {span(r.recoveryDelay)}. A guardian has {span(r.approvalWindow)} to approve a large payment.
        </Rule>
      </dl>
    </Panel>
  );
}

const STEP_WORDS: Record<Step["kind"], string> = {
  proposed: "Signed on the puck and recorded by the vault",
  alerted: "Alarm light lit up and reported it",
  confirmed: "Second yes on the puck; the network timer started",
  approved: "Approved by a guardian; the network timer started",
  vetoed: "Stopped",
  executed: "Money left the vault",
  cancelled: "Cancelled",
  expired: "Ran out of time, nothing left",
  failed: "The network timer could not be booked",
};

const OUTCOME: Record<Story["outcome"], [string, string]> = {
  waiting: ["Waiting", "bg-hold-wash text-hold"],
  executed: ["Sent", "bg-safe-wash text-safe"],
  vetoed: ["Stopped", "bg-stop-wash text-stop"],
  cancelled: ["Cancelled", "bg-plaster text-ink-soft"],
  expired: ["Expired", "bg-plaster text-ink-soft"],
};

const TIER_WORDS = ["Instant, to a saved name", "Held for the cool-off", "Needs a guardian's yes"];

function StoryCard({ s, d }: { s: Story; d: Data }) {
  const rel = d.releases[s.id];
  const [label, tone] = OUTCOME[s.outcome];
  return (
    <li className="rounded-xl border-2 border-line p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-narrow text-lg font-[750] text-ink-soft tabular">#{s.id}</span>
        <span className="font-wide text-xl font-[800]">{money(s.amount, s.token, d.rules)}</span>
        <Named a={s.to} r={d.rules} />
        <span className={`ms-auto rounded-full px-3 py-0.5 text-sm font-bold ${tone}`}>{label}</span>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{TIER_WORDS[s.tier] ?? `Tier ${s.tier}`}</p>
      <ol className="mt-3 space-y-2 border-s-2 border-line ps-4">
        {s.steps.map((st, i) => {
          const network = st.kind === "executed" && rel?.scheduled;
          return (
            <li key={i} className="relative">
              <span className={`absolute -start-[1.42rem] top-1.5 size-3 rounded-full ${network ? "bg-safe" : st.kind === "vetoed" ? "bg-stop" : "bg-ink/40"}`} aria-hidden="true" />
              <p className={network ? "font-bold text-safe" : st.kind === "vetoed" ? "font-bold text-stop" : ""}>
                {network ? "Released by the network: a Hedera scheduled transaction, paid by the vault" : STEP_WORDS[st.kind]}
                {st.by && (st.kind === "approved" || st.kind === "vetoed") && <span className="font-normal text-ink-soft"> by {who(st.by, d.rules)}</span>}
              </p>
              <p className="text-sm text-ink-soft">
                {when(st.at)}
                {" · "}
                {st.tx ? (
                  <Ext href={txLink(st.tx)}>transaction</Ext>
                ) : st.seq !== undefined ? (
                  <Ext href={`${d.source.mirror}/api/v1/topics/${d.source.topic}/messages/${st.seq}`}>log message {st.seq}</Ext>
                ) : null}
                {network && s.schedule && (
                  <>
                    {" · "}
                    <Ext href={hashscanSchedule(s.schedule)}>schedule {s.schedule}</Ext>
                    {" · "}
                    <span className="font-mono">scheduled = true</span>
                  </>
                )}
                {st.kind === "executed" && rel && !rel.scheduled && s.tier === TIER.INSTANT && " · paid in the same transaction as the puck's signature"}
              </p>
            </li>
          );
        })}
      </ol>
    </li>
  );
}

const HCS_WORDS: Record<HcsType, string> = {
  REQUEST: "Payment requested",
  PAY_SIGNED: "Signed on the puck",
  PROPOSED: "Recorded by the vault",
  ALERT_ACK: "Alarm acknowledged",
  VETO_SIGNED: "Stop signed",
  VETOED: "Stopped",
  APPROVE_SIGNED: "Approval signed",
  APPROVED: "Approved by a guardian",
  RECONFIRM_SIGNED: "Second yes signed",
  CONFIRMED: "Confirmed, timer started",
  CANCELLED: "Cancelled",
  RELEASED: "Released",
  FROZEN: "Frozen",
  AGENT_PAID: "Helper paid",
  AGENT_REFUSED: "Helper refused",
  SCHEDULE_FAILED: "Network timer failed",
  CHANGE_SIGNED: "Rule change signed on the puck",
  CHANGE_APPROVED: "Rule change approved",
  CHANGE_VETOED: "Rule change stopped",
  CHANGE_APPLIED: "Rule change applied",
};

function LogPanel({ d }: { d: Data }) {
  const [all, setAll] = useState(false);
  const lines = all ? d.log : d.log.slice(0, 15);
  return (
    <Panel title="The public log" raw={`${d.source.mirror}/api/v1/topics/${d.source.topic}/messages?order=desc`}>
      <p className="mb-3 text-ink-soft">
        Every step is also written to Hedera Consensus Service topic <Ext href={hashscanTopic(d.source.topic)}>{d.source.topic}</Ext>, in order, with a timestamp nobody can change.
        Messages signed by a device carry its signature.
      </p>
      <ol className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.seq} className="grid grid-cols-[3.2rem_1fr] gap-x-3 py-2 sm:grid-cols-[3.2rem_10rem_1fr]">
            <a className="font-narrow font-[750] text-door tabular" href={`${d.source.mirror}/api/v1/topics/${d.source.topic}/messages/${l.seq}`} target="_blank" rel="noreferrer">
              {l.seq}
            </a>
            <span className="text-sm text-ink-soft sm:text-base">{when(l.at)}</span>
            <span className="col-start-2 sm:col-start-3">
              <strong>{l.msg ? HCS_WORDS[l.msg.type] : "Unreadable"}</strong>
              {l.msg && l.msg.ref > 0 && <span className="text-ink-soft"> · payment {l.msg.ref}</span>}
              {l.msg?.type === "AGENT_REFUSED" && typeof l.msg.body.reason === "string" && <span className="text-ink-soft"> · {l.msg.body.reason}</span>}
              {l.msg?.signer && <span className="text-ink-soft"> · signed by {who(l.msg.signer, d.rules)}</span>}
            </span>
          </li>
        ))}
      </ol>
      {d.log.length > 15 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-3 font-bold text-door">
          {all ? "Show fewer" : `Show all ${d.log.length}`}
        </button>
      )}
    </Panel>
  );
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    setBusy(true);
    load(window.location.search)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex items-center gap-3 py-4">
        <svg viewBox="0 0 32 32" className="size-9" aria-hidden="true">
          <path d="M6 30V14a10 10 0 0 1 20 0v16" fill="none" stroke="var(--color-door)" strokeWidth="4" />
          <path d="M12 30v-9h8v9" fill="var(--color-ink)" />
        </svg>
        <div className="flex-1">
          <h1 className="font-wide text-2xl leading-none font-[800]">Check it yourself</h1>
          <p className="text-ink-soft">A Hisn vault, read straight from Hedera</p>
        </div>
        <button type="button" onClick={refresh} disabled={busy} className="rounded-lg border-2 border-line bg-paper px-3 py-1.5 font-bold disabled:opacity-50">
          {busy ? "Reading…" : "Read again"}
        </button>
      </header>
      <p className="mb-5 text-lg leading-relaxed">
        This page has no server and no login. Your browser asks Hedera's public mirror node directly, and the page is not allowed to talk to anything else. If Hisn's own
        server disappeared tomorrow, everything below would still be here.
      </p>
      {error && (
        <p className="mb-5 rounded-xl bg-stop-wash p-4 font-bold text-stop" role="alert">
          Could not read the mirror node: {error}
        </p>
      )}
      {!data ? (
        !error && <p className="py-20 text-center text-lg text-ink-soft">Reading the vault from the mirror node…</p>
      ) : (
        <main className="space-y-6">
          <Proof d={data} />
          <RulesPanel d={data} />
          <Panel title="Payments" raw={`${data.source.mirror}/api/v1/contracts/${data.source.vaultId}/results/logs?order=desc`}>
            <p className="mb-3 text-ink-soft">Rebuilt from the vault's own events, newest first. Every step links to its transaction.</p>
            {data.stories.length === 0 ? <p>No payments yet.</p> : <ul className="space-y-3">{data.stories.map((s) => <StoryCard key={s.id} s={s} d={data} />)}</ul>}
          </Panel>
          {data.helper.length > 0 && (
            <Panel title="Paid by the helper">
              <p className="mb-3 text-ink-soft">The helper can only pay saved names, within its daily allowance. The vault checks both.</p>
              <ul className="divide-y divide-line">
                {data.helper.map((h) => (
                  <li key={h.tx} className="flex flex-wrap gap-x-3 py-2">
                    <strong>{money(h.amount, h.token, data.rules)}</strong>
                    <Named a={h.to} r={data.rules} />
                    <span className="ms-auto text-sm text-ink-soft">
                      {when(h.at)} · <Ext href={txLink(h.tx)}>transaction</Ext>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <LogPanel d={data} />
          <p className="text-center text-sm text-ink-soft">
            Read from {data.source.mirror} at {data.readAt.toLocaleTimeString()}. Reads again every 20 seconds.
          </p>
        </main>
      )}
    </div>
  );
}
