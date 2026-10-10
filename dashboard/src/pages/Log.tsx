import { useState } from "react";
import { Link } from "react-router";
import type { HcsType, TimelineEntry } from "@hisn/shared";
import { Icon } from "../components/Icon";
import { TopicLink, TxLink } from "../components/Links";
import { StatusChip } from "../components/Status";
import { Empty, PageTitle, Panel } from "../components/ui";
import { useSnapshot } from "../data/store";
import { consensus, timeOfDay } from "../lib/format";
import { useNames } from "../lib/people";

export const HCS_WORDS: Record<HcsType, string> = {
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

function Row({ e }: { e: TimelineEntry }) {
  const { state } = useSnapshot();
  const { nameOf } = useNames();
  const [open, setOpen] = useState(false);
  const m = e.hcs;
  const isPayment = m && m.ref > 0 && !["FROZEN", "AGENT_REFUSED", "AGENT_PAID", "CHANGE_SIGNED", "CHANGE_APPROVED", "CHANGE_VETOED", "CHANGE_APPLIED"].includes(m.type) && !(m.type === "REQUEST" || m.type === "PAY_SIGNED");
  return (
    <li>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 md:grid-cols-[9rem_1fr_14rem_auto]">
        <span className="tabular-nums text-sm text-ink-soft">{e.consensusTimestamp ? consensus(e.consensusTimestamp) : timeOfDay(e.at)}</span>
        <span className="min-w-0">
          <span className="font-[700]">{m ? HCS_WORDS[m.type] : e.name}</span>
          {m && isPayment && (
            <Link to={`/payments/${m.ref}`} className="ml-2 text-sm font-[700] text-door">
              #{m.ref}
            </Link>
          )}
          {m && typeof m.body.amount === "string" && <span className="ml-2 text-sm text-ink-soft">{m.body.amount}</span>}
        </span>
        <span className="col-span-2 text-sm md:col-span-1">
          {m?.signer ? (
            e.verified ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusChip tone="safe" icon="check" word="Signature checks out" size="sm" />
                <span className="text-ink-soft">{nameOf(m.signer, state)}</span>
              </span>
            ) : (
              <StatusChip tone="stop" icon="warn" word="Signature does not match" size="sm" />
            )
          ) : (
            <span className="text-ink-soft">Posted by the relayer</span>
          )}
        </span>
        <button type="button" className="justify-self-end text-sm font-[700] text-door" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Raw"}
        </button>
      </div>
      {open && (
        <pre className="mx-5 mb-4 overflow-x-auto rounded-input bg-ink p-4 text-[0.8rem] leading-relaxed text-paper">{JSON.stringify(m ?? e, null, 2)}</pre>
      )}
    </li>
  );
}

export function Log() {
  const { log } = useSnapshot();
  const [chainToo, setChainToo] = useState(false);
  const shown = log.filter((e) => chainToo || e.kind === "hcs");
  return (
    <div>
      <PageTitle
        title="Public log"
        lead="Every step is posted to a Hedera Consensus Service topic. The network puts a timestamp on each message, so nobody, including us, can change the order later."
      >
        <TopicLink />
      </PageTitle>
      <label className="mb-4 inline-flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-door" checked={chainToo} onChange={(e) => setChainToo(e.target.checked)} />
        Also show vault contract events
      </label>
      {shown.length === 0 ? (
        <Empty icon="clock" title="No messages yet" />
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {shown.map((e, i) =>
              e.kind === "hcs" ? (
                <Row key={`${e.consensusTimestamp}-${i}`} e={e} />
              ) : (
                <li key={`${e.tx}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-plaster/50 px-5 py-2.5 text-sm">
                  <span className="w-[9rem] tabular-nums text-ink-soft">{timeOfDay(e.at)}</span>
                  <Icon name="gate" size={16} className="text-ink-soft" />
                  <span className="font-[700]">Contract event: {e.name}</span>
                  <TxLink tx={e.tx}>tx</TxLink>
                </li>
              ),
            )}
          </ul>
        </Panel>
      )}
    </div>
  );
}
