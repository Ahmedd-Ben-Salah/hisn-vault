import type { PaymentView } from "@hisn/shared";
import { money, short, timeOfDay } from "../lib/format";
import type { Phase } from "../lib/phase";
import { Icon } from "./Icon";
import { StopPayment } from "./StopPayment";
import { ButtonLink, Progress } from "./ui";

export function WaitingBanner({ p, ph, now, more, name }: { p: PaymentView; ph: Phase; now: number; more: number; name: string }) {
  const confirm = ph.key === "confirm_now";
  const approval = ph.key === "needs_guardian";
  const end = approval || confirm || ph.key === "cooling" ? p.expiresAt : p.releaseAt || ph.until || now;
  const value = end > p.proposedAt ? (now - p.proposedAt) / (end - p.proposedAt) : 1;
  const title = confirm
    ? "Confirm on your puck to let it leave"
    : approval
      ? `${money(p.amount, p.token)} needs your guardian's approval`
      : `${money(p.amount, p.token)} to ${name} is waiting`;
  return (
    <section className="rounded-card bg-hold-wash p-6 text-hold-text md:p-7" aria-label="Payment waiting">
      <div className="flex items-start gap-4">
        <span className="inline-flex size-[60px] shrink-0 items-center justify-center rounded-full bg-ink text-paper">
          <Icon name="clock" size={28} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-[800] tracking-wide text-hold uppercase">{ph.word}</p>
          <h2 className="mt-1 text-[22px] leading-tight font-[800] md:text-[24px]">{title}</h2>
          <p className="mt-1 text-[15px]">
            {approval ? "Nothing leaves until your guardian says yes" : confirm || ph.key === "cooling" ? `Leaves only after your second yes. If you do not confirm by ${timeOfDay(p.expiresAt)}, nothing is sent` : `Leaves at ${timeOfDay(end)}`} · {short(p.to)} · Your guardian was alerted at {timeOfDay(p.proposedAt)}
            {more > 0 && ` · and ${more} more`}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <Progress value={value} onWait from={`Signed ${timeOfDay(p.proposedAt)}`} to={approval || confirm || ph.key === "cooling" ? `Ends ${timeOfDay(p.expiresAt)}` : `Leaves ${timeOfDay(end)}`} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <StopPayment paymentId={p.id} />
        <ButtonLink to={`/payments/${p.id}`} look="outline" size="lg">
          Details
        </ButtonLink>
      </div>
      <p className="mt-4 text-[14px]">Stopping is always safe. The money stays in your account.</p>
    </section>
  );
}
