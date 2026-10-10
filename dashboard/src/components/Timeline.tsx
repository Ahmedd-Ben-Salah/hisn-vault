import type { PaymentView, TimelineEntry } from "@hisn/shared";
import { consensus, timeOfDay } from "../lib/format";
import type { IconName, Phase, Tone } from "../lib/phase";

import { TxLink } from "./Links";
import { TONE_TEXT } from "./Status";

interface Step {
  label: string;
  who: string;
  icon: IconName;
  names: string[];
  tone: Tone;
}

function stepsFor(p: PaymentView): Step[] {
  if (p.executedBy === "agent") {
    return [{ label: "Paid by the helper", who: "Inside its allowance, to a saved name", icon: "bolt", names: ["AgentPaid", "AGENT_PAID"], tone: "safe" }];
  }
  const head: Step[] = [
    { label: "Asked", who: "From this page or the helper", icon: "send", names: ["REQUEST"], tone: "door" },
    { label: "Approved on the puck", who: "You read it on the device", icon: "key", names: ["PAY_SIGNED"], tone: "door" },
    { label: "Recorded by your account", who: "The rule was chosen by the contract", icon: "gate", names: ["Proposed", "PROPOSED"], tone: "door" },
  ];
  if (p.tier === "INSTANT") {
    return [...head, { label: "Paid", who: "Saved name, small amount", icon: "check", names: ["Executed"], tone: "safe" }];
  }
  const middle: Step[] = [
    { label: "Guardian alerted", who: "Alarm light and phones", icon: "warn", names: ["ALERT_ACK"], tone: "hold" },
    p.tier === "WAIT"
      ? { label: "Confirmed again", who: "Your second yes on the puck", icon: "key", names: ["RECONFIRM_SIGNED", "Confirmed", "CONFIRMED"], tone: "hold" }
      : { label: "Approved by your guardian", who: "After speaking to you", icon: "person", names: ["APPROVE_SIGNED", "Confirmed", "APPROVED"], tone: "hold" },
  ];
  let end: Step = { label: "Leaves", who: "Sent by the Hedera network timer", icon: "bolt", names: ["Executed", "RELEASED"], tone: "safe" };
  if (p.status === "VETOED") end = { label: "Stopped", who: "Guardian or alarm light", icon: "hand", names: ["Vetoed", "VETOED", "VETO_SIGNED"], tone: "stop" };
  if (p.status === "CANCELLED") end = { label: "Cancelled", who: "On the puck, or by a freeze", icon: "cross", names: ["Cancelled", "CANCELLED"], tone: "quiet" };
  if (p.status === "EXPIRED") end = { label: "Expired", who: p.tier === "WAIT" ? "No second yes in time" : "No guardian yes in time", icon: "clock", names: ["Expired"], tone: "quiet" };
  if (p.executedBy === "relayer") end = { label: "Sent by hand", who: "Retry after the network timer failed", icon: "bolt", names: ["Executed"], tone: "safe" };
  if (p.executedBy === "direct") end = { label: "Sent by a direct call", who: "Someone called the vault after the release time", icon: "bolt", names: ["Executed"], tone: "safe" };
  return [...head, ...middle, end];
}

export function Timeline({ payment, entries, phase }: { payment: PaymentView; entries: TimelineEntry[]; phase: Phase }) {
  const steps = stepsFor(payment);
  const hits = steps.map((s) => entries.find((e) => s.names.includes(e.name)) ?? null);
  const lastDone = hits.reduce((acc, h, i) => (h ? i : acc), -1);
  const finished = !phase.live;
  return (
    <ol aria-label="What has happened">
      {steps.map((s, i) => {
        const hit = hits[i];
        const done = !!hit;
        const skipped = !done && (finished || i < lastDone);
        const current = !done && !skipped && i === lastDone + 1;
        const last = i === steps.length - 1;
        const dot = done
          ? s.tone === "stop"
            ? "bg-stop ring-stop"
            : "bg-ink ring-ink"
          : current
            ? "bg-hold-track ring-ink"
            : "bg-paper ring-border";
        return (
          <li key={s.label} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span className={`absolute top-6 bottom-0 left-[8px] w-[3px] ${i < lastDone ? "bg-ink" : "bg-line"}`} aria-hidden="true" />}
            <span className={`relative z-10 mt-1 size-[18px] shrink-0 rounded-full ring-[3px] ring-inset ${dot}`} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4">
              <div className="min-w-0">
                <p className={`text-[17px] font-[800] leading-tight ${done || current ? "text-ink" : "text-ink-soft"}`}>
                  {s.label}
                  <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : skipped ? " (did not happen)" : " (not yet)"}</span>
                </p>
                <p className="text-[14px] text-ink-soft">{skipped ? "Did not happen" : s.who}</p>
              </div>
              {hit && (
                <p className="text-[14px] font-[600] tabular-nums">
                  {hit.consensusTimestamp ? <span title="Time from the public record">{consensus(hit.consensusTimestamp)}</span> : timeOfDay(hit.at)}
                  {hit.tx && (
                    <>
                      {" "}
                      <TxLink tx={hit.tx}>tx</TxLink>
                    </>
                  )}
                </p>
              )}
              {current && <p className={`text-[14px] font-[800] ${TONE_TEXT.hold}`}>Now</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
