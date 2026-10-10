import { Link } from "react-router";
import type { PaymentView, StateView } from "@hisn/shared";
import { amount, ago, short, timeOfDay, token } from "../lib/format";
import { useNames } from "../lib/people";
import { phaseOf, type Tone } from "../lib/phase";
import { Avatar } from "./ui";
import { TONE_TEXT } from "./Status";

/** ListRow: avatar, name over detail, amount over status. The whole row is a link. */
export function PaymentRow({ p, state, now }: { p: PaymentView; state: StateView; now: number }) {
  const { nameOf } = useNames();
  const ph = phaseOf(p, state, now);
  const name = p.label ?? (nameOf(p.to, state).includes("…") ? "New recipient" : nameOf(p.to, state));
  const avatarTone: Tone = ph.tone === "hold" ? "hold" : ph.tone === "stop" ? "stop" : "quiet";
  const detail =
    ph.key === "releasing" ? `Leaves at ${timeOfDay(p.releaseAt)}` : ph.key === "cooling" || ph.key === "confirm_now" ? "Waits for a second yes" : ph.key === "needs_guardian" ? "Needs approval" : ago(p.proposedAt, now);
  return (
    <Link to={`/payments/${p.id}`} className="flex items-center gap-4 border-t border-line py-4 transition-colors first:border-t-0 hover:bg-soft/50">
      <Avatar name={name} tone={avatarTone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-[700]">{name}</span>
        <span className="block truncate text-[14px] text-ink-soft">
          {short(p.to)} · {detail}
          {p.executedBy === "agent" && " · paid by the helper"}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-[17px] font-[800] tabular-nums">
          {amount(p.amount, p.token)} {token(p.token).symbol}
        </span>
        <span className={`block text-[14px] font-[600] ${TONE_TEXT[ph.tone]}`}>{ph.word}</span>
      </span>
    </Link>
  );
}

export function PaymentRows({ payments, state, now }: { payments: PaymentView[]; state: StateView; now: number }) {
  return (
    <ul>
      {payments.map((p) => (
        <li key={p.id} className="[&:first-child>a]:border-t-0">
          <PaymentRow p={p} state={state} now={now} />
        </li>
      ))}
    </ul>
  );
}
