import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { hashscanSchedule, hashscanTopic, hashscanTx, type TimelineEntry } from "@hisn/shared";
import { Icon } from "../components/Icon";
import { useOffChain } from "../components/Links";
import { StatusChip } from "../components/Status";
import { StopPayment } from "../components/StopPayment";
import { Timeline } from "../components/Timeline";
import { AddressText, Button, ButtonLink, Card, Empty, Fact, Progress, Tinted } from "../components/ui";
import { useSnapshot, useSource } from "../data/store";
import { duration, money, timeOfDay } from "../lib/format";
import { useNames } from "../lib/people";
import { canExecuteByHand, phaseOf, type Phase } from "../lib/phase";
import type { PaymentView } from "@hisn/shared";

const RULE = { INSTANT: "Right away", WAIT: "Waits", APPROVAL: "Needs approval" } as const;

function explain(p: PaymentView, ph: Phase, guardian: string): string {
  switch (ph.key) {
    case "cooling":
      return `You will be asked to confirm again at ${timeOfDay(p.confirmFrom)}.`;
    case "confirm_now":
      return `Confirm once more on your puck to let it leave at ${timeOfDay(Math.max(p.releaseAt, p.confirmFrom))}.`;
    case "releasing":
      return `Leaves by itself at ${timeOfDay(p.releaseAt)}, unless you or ${guardian} stop it.`;
    case "due":
      return "Its time has come. The Hedera network should send it in a few seconds.";
    case "needs_guardian":
      return `Nothing leaves until ${guardian} approves.`;
    case "released":
      return p.executedBy === "agent" ? "Paid by the helper, inside its allowance." : p.tier === "INSTANT" ? "Sent right away." : "Sent by the Hedera network.";
    case "stopped":
      return "Stopped. The money never left your account.";
    case "cancelled":
      return "You cancelled this payment. Nothing was sent.";
    case "frozen_out":
      return "Your account was frozen while this waited. Nothing was sent.";
    case "expired":
      return "Not confirmed in time. Nothing was sent.";
  }
}

function ProofRow({ label, href }: { label: string; href: string | null }) {
  const off = useOffChain();
  if (!href) return null;
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
      <span>{label}</span>
      {off ? (
        <span className="text-[14px] text-ink-soft">({off})</span>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className="font-[700] underline underline-offset-4 hover:text-door">
          HashScan
        </a>
      )}
    </li>
  );
}

export function PaymentDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const source = useSource();
  const { nameOf } = useNames();
  const off = useOffChain();
  const { payments, state, now, log } = useSnapshot();
  const p = payments.find((x) => x.id === pid);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    source
      .timeline(pid)
      .then((e) => alive && setEntries(e))
      .catch(() => void 0);
    return () => {
      alive = false;
    };
  }, [source, pid, p?.status, p?.confirmed, log.length]);

  if (!p) {
    return (
      <Empty icon="list" title="We could not find this payment.">
        <Link to="/payments" className="font-[700] underline underline-offset-4">
          See all payments
        </Link>
      </Empty>
    );
  }

  const ph = phaseOf(p, state, now);
  const guardian = (state.guardians[0] ? nameOf(state.guardians[0], state) : "your guardian").split(",")[0];
  const manual = canExecuteByHand(p, ph, now);
  const name = p.label ?? null;
  const title = `${money(p.amount, p.token)} to ${name ?? "a new recipient"}`;
  const chipWord = ph.key === "cooling" || ph.key === "releasing" || ph.key === "due" ? "Waiting" : ph.word;
  const end = ph.key === "cooling" ? p.confirmFrom : p.releaseAt;
  const showProgress = ph.key === "cooling" || ph.key === "releasing";

  async function retry() {
    setBusy(true);
    setNote(null);
    try {
      await source.executeByHand(pid);
      setNote({ ok: true, text: "Sent. It may take a few seconds to show here." });
    } catch {
      setNote({ ok: false, text: "The network could not deliver it. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const data = await source.exportEvidence(pid);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hisn-payment-${pid}-record.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Link to="/payments" className="mb-6 inline-flex min-h-11 items-center gap-1 font-[700] text-ink-soft hover:text-ink">
        <span aria-hidden="true">‹</span> Payments
      </Link>
      <div className="grid gap-12 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-8">
          <div>
            <StatusChip tone={ph.tone} icon={ph.icon} word={chipWord} />
            <h1 className="mt-4 text-[28px] leading-[1.05] font-[900] tracking-[-1px] md:text-[44px] md:tracking-[-1.5px]">{title}</h1>
            <p className="mt-3 text-[17px]">{explain(p, ph, guardian)}</p>
          </div>

          {ph.live && (
            <div className="rounded-card bg-hold-wash p-6 text-hold-text">
              {ph.key === "confirm_now" && (
                <p className="mb-4 flex gap-3 text-[17px]">
                  <Icon name="key" size={22} className="mt-0.5" />
                  <span>
                    <strong>Check your puck.</strong> It asks: "Has anyone told you to keep this secret or told you what to say?" Say yes only if no one has.
                  </span>
                </p>
              )}
              {showProgress && (
                <div className="mb-5">
                  <Progress value={end > p.proposedAt ? (now - p.proposedAt) / (end - p.proposedAt) : 1} onWait from={`Signed ${timeOfDay(p.proposedAt)}`} to={ph.key === "cooling" ? `Confirm at ${timeOfDay(end)}` : `Leaves ${timeOfDay(end)}`} />
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <StopPayment paymentId={p.id} />
                {manual && (
                  <Button look="outline" size="lg" onClick={retry} disabled={busy}>
                    Retry
                  </Button>
                )}
              </div>
              {manual && <p className="mt-3 text-[14px]">The network timer has not sent it yet. Retry calls the same check in your account. It cannot skip a wait or a guardian.</p>}
              <p className="mt-4 text-[14px]">Stopping is always safe. The money stays in your account.</p>
            </div>
          )}

          {ph.key === "stopped" && (
            <Tinted tint="stop" className="p-6">
              <p className="text-[18px] font-[800]">The money never left your account.</p>
              <p className="mt-1">Nobody can recover money for a fee.</p>
            </Tinted>
          )}
          {ph.key === "expired" && (
            <ButtonLink to="/send" look="outline">
              Send again
            </ButtonLink>
          )}
          {ph.key === "released" && p.txs.executed && !off && (
            <a href={hashscanTx(p.txs.executed)} target="_blank" rel="noreferrer" className="inline-block font-[700] underline underline-offset-4 hover:text-door">
              See the transaction
            </a>
          )}
          {note && (
            <p className={`font-[700] ${note.ok ? "text-safe" : "text-stop-fg"}`} role="status">
              {note.text}
            </p>
          )}

          <section>
            <h2 className="mb-4 text-[22px] font-[800]">What has happened</h2>
            <Timeline payment={p} entries={entries} phase={ph} />
          </section>
        </div>

        <aside className="space-y-5">
          <Card title="Details">
            <dl>
              <Fact label="To">
                <AddressText address={p.to} />
                <span className="block text-[14px] font-[500] text-ink-soft">{name ? `Saved name: ${name}` : "New recipient. No saved name."}</span>
              </Fact>
              <Fact label="Amount">{money(p.amount, p.token)}</Fact>
              <Fact label="Rule">{RULE[p.tier]}</Fact>
              {p.tier !== "INSTANT" && <Fact label="Why">{p.newRecipient ? "New recipient" : p.tier === "APPROVAL" ? "Over the waiting limit" : "Over the instant limit"}</Fact>}
              {p.tier !== "INSTANT" && <Fact label="Wait">{duration(p.releaseAt - p.proposedAt)}</Fact>}
              <Fact label="Guardian">{guardian}</Fact>
            </dl>
          </Card>
          <Card title="Proof">
            <ul>
              <ProofRow label="Transaction" href={p.txs.executed ? hashscanTx(p.txs.executed) : p.txs.proposed ? hashscanTx(p.txs.proposed) : null} />
              <ProofRow label="Network timer" href={p.schedule ? hashscanSchedule(p.schedule) : null} />
              <ProofRow label="Public record" href={state.topicId ? hashscanTopic(state.topicId) : null} />
            </ul>
            <button type="button" onClick={download} className="mt-4 min-h-11 font-[700] underline underline-offset-4 hover:text-door">
              Download the record
            </button>
          </Card>
          <Tinted>Our server cannot move or block your money. Every step above is recorded on the Hedera network.</Tinted>
        </aside>
      </div>
    </div>
  );
}
