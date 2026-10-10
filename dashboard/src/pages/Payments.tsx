import { useState } from "react";
import { Link } from "react-router";
import type { PaymentView } from "@hisn/shared";
import { PaymentRows } from "../components/PaymentRow";
import { ButtonLink, Card, Empty, Fact, PageTitle, Tinted } from "../components/ui";
import { useSnapshot, useUsdc } from "../data/store";
import { dateTime, money } from "../lib/format";
import { useNames } from "../lib/people";
import { phaseOf } from "../lib/phase";

type Filter = "all" | "open" | "paid" | "stopped";

function dayOf(at: number, now: number): string {
  const d = new Date(at * 1000).toDateString();
  if (d === new Date(now * 1000).toDateString()) return "Today";
  if (d === new Date((now - 86400) * 1000).toDateString()) return "Yesterday";
  return "Earlier";
}

export function Payments() {
  const { payments, state, now } = useSnapshot();
  const usdc = useUsdc();
  const { nameOf } = useNames();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const phases = new Map(payments.map((p) => [p.id, phaseOf(p, state, now)]));
  const isStopped = (p: PaymentView) => ["stopped", "cancelled", "frozen_out"].includes(phases.get(p.id)!.key);
  const waiting = payments.filter((p) => phases.get(p.id)!.live);

  const query = q.trim().toLowerCase();
  const shown = payments.filter((p) => {
    const ph = phases.get(p.id)!;
    if (filter === "open" && !ph.live) return false;
    if (filter === "paid" && ph.key !== "released") return false;
    if (filter === "stopped" && !isStopped(p)) return false;
    if (!query) return true;
    return [p.label ?? "", nameOf(p.to, state), p.to].some((s) => s.toLowerCase().includes(query));
  });
  const groups = (["Today", "Yesterday", "Earlier"] as const).map((g) => ({ g, items: shown.filter((p) => dayOf(p.proposedAt, now) === g) })).filter((x) => x.items.length > 0);

  const usd = payments.filter((p) => p.token.toLowerCase() === usdc.toLowerCase());
  const sum = (xs: PaymentView[]) => xs.reduce((a, p) => a + BigInt(p.amount), 0n);
  const paidOut = sum(usd.filter((p) => phases.get(p.id)!.key === "released"));
  const waitingNow = sum(usd.filter((p) => phases.get(p.id)!.live));
  const stopped = payments.filter(isStopped);
  const latestStop = [...stopped].sort((a, b) => b.proposedAt - a.proposedAt)[0];
  const since = payments.length ? Math.min(...payments.map((p) => p.proposedAt)) : now;

  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "All" },
    { key: "open", label: `Waiting · ${waiting.length}` },
    { key: "paid", label: "Paid" },
    { key: "stopped", label: "Stopped" },
  ];

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        <PageTitle title="Payments">
          <ButtonLink to="/send" icon="send">
            Send
          </ButtonLink>
        </PageTitle>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter payments">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`h-[42px] rounded-full px-4 font-[800] ${filter === f.key ? "bg-ink text-paper" : "border-[1.5px] border-border text-ink-soft hover:text-ink"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a name or address"
            aria-label="Search payments"
            className="h-[42px] min-w-0 flex-1 rounded-full border-[1.5px] border-border px-4 focus:border-ink focus:outline-none sm:max-w-xs"
          />
        </div>
        {groups.length === 0 ? (
          <Empty icon="list" title="Nothing here yet." />
        ) : (
          groups.map(({ g, items }) => (
            <section key={g} className="mt-6">
              <h2 className="mb-1 text-[14px] font-[800] text-ink-soft uppercase">{g}</h2>
              <PaymentRows payments={items} state={state} now={now} />
            </section>
          ))
        )}
      </div>
      <aside className="space-y-5 lg:pt-[92px]">
        <Card title={`Since ${dateTime(since).split(",")[0]}`}>
          <dl>
            <Fact label="Paid out">{money(paidOut, usdc)}</Fact>
            <Fact label="Waiting now">{money(waitingNow, usdc)}</Fact>
            <Fact label="Stopped">{stopped.length}</Fact>
          </dl>
        </Card>
        {latestStop && (
          <Tinted tint="stop">
            <p className="font-[800]">Latest stop</p>
            <p className="mt-1">
              {money(latestStop.amount, latestStop.token)} to {latestStop.label ?? "a new recipient"} was stopped. The money never left your account.{" "}
              <Link to={`/payments/${latestStop.id}`} className="font-[700] underline underline-offset-4">
                Details
              </Link>
            </p>
          </Tinted>
        )}
        <Link to="/log" className="block px-1 font-[700] underline underline-offset-4 hover:text-door">
          See the public record of all payments
        </Link>
      </aside>
    </div>
  );
}
