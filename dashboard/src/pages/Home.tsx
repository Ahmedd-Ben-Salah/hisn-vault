import { useState } from "react";
import { Link } from "react-router";
import { HBAR } from "@hisn/shared";
import { Icon } from "../components/Icon";
import { PaymentRows } from "../components/PaymentRow";
import { DeviceDots } from "../components/Shell";
import { AddressText, Avatar, Button, ButtonLink, Card, Empty, Tinted } from "../components/ui";
import { WaitingBanner } from "../components/WaitingBanner";
import { QuantumCard } from "../components/QuantumCard";
import { useSnapshot, useSource, useUsdc } from "../data/store";
import { amount, dateTime, duration, money } from "../lib/format";
import { useNames } from "../lib/people";
import { accountStatus, phaseOf } from "../lib/phase";
import { limitBig } from "../lib/windows";

export function Home() {
  const snap = useSnapshot();
  const source = useSource();
  const usdc = useUsdc();
  const { state, payments, now, requests } = snap;
  const { nameOf } = useNames();
  const status = accountStatus(state, payments, now);
  const lim = limitBig(state.limits.usdc);
  const onPuck = requests.filter((r) => r.status === "waiting_puck");
  const open = payments.filter((p) => phaseOf(p, state, now).live).length;
  const guardianFull = state.guardians[0] ? nameOf(state.guardians[0], state) : "Your guardian";
  const guardian = guardianFull.split(",")[0];
  const [showDeposit, setShowDeposit] = useState(false);
  const [freezeAsked, setFreezeAsked] = useState(false);

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_390px]">
      <div className="min-w-0 space-y-8">
        <div>
          <p className="text-[17px] font-[600] text-ink-soft">Total protected</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="text-[52px] leading-none font-[900] tracking-[-2px] tabular-nums md:text-[68px] md:tracking-[-2.5px]">{amount(state.balances.usdc, usdc)}</span>
            <span className="text-[24px] font-[900] text-ink-soft md:text-[30px]">USDC</span>
          </p>
          <p className="mt-2 text-[17px] text-ink-soft">
            plus <strong className="text-ink tabular-nums">{money(state.balances.hbar, HBAR)}</strong>
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink to="/send" icon="send" size="lg" className="max-md:h-[62px] max-md:w-full">
              Send
            </ButtonLink>
            <Button look="quiet" size="lg" icon="download" onClick={() => setShowDeposit((v) => !v)}>
              Add money
            </Button>
            <Button
              look="quiet"
              size="lg"
              icon="snow"
              onClick={() => {
                setFreezeAsked(true);
                void source.requestFreeze().catch(() => undefined);
              }}
            >
              Freeze
            </Button>
          </div>
          {showDeposit && (
            <Tinted className="mt-4">
              <p className="font-[700]">Send USDC or HBAR on Hedera testnet to your account:</p>
              <p className="mt-2">
                <AddressText address={state.vault} />
              </p>
              {state.vaultId && <p className="mt-1 text-[14px]">Account id {state.vaultId}</p>}
            </Tinted>
          )}
          {freezeAsked && status.mood !== "frozen" && (
            <Tinted tint="stop" className="mt-4">
              Check your puck and enter your PIN to freeze. Nothing can leave while the account is frozen.
            </Tinted>
          )}
        </div>

        {onPuck.length > 0 && (
          <Tinted className="flex items-start gap-3" >
            <Icon name="key" size={22} className="mt-0.5" />
            <p>
              <strong>Check your puck.</strong> {onPuck.map((r) => `${money(r.amount, r.token)} to ${nameOf(r.to, state)}`).join(", ")} is waiting for your yes. Read the puck's screen, not this one.
            </p>
          </Tinted>
        )}

        {status.mood === "frozen" ? (
          <Tinted tint="stop" className="p-6">
            <p className="text-[22px] font-[800]">Your account is frozen until {dateTime(state.frozenUntil)}.</p>
            <p className="mt-1">Nothing can leave. The freeze ends by itself unless a different person renews it.</p>
          </Tinted>
        ) : (
          status.focus &&
          status.phase && (
            <WaitingBanner p={status.focus} ph={status.phase} now={now} more={open - 1} name={status.focus.label ?? "a new recipient"} />
          )
        )}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[22px] font-[800]">Recent payments</h2>
            <Link to="/payments" className="font-[700] text-ink underline-offset-4 hover:text-door hover:underline">
              See all
            </Link>
          </div>
          {payments.length === 0 ? (
            <Empty icon="send" title="Nothing here yet.">
              Send your first payment.
            </Empty>
          ) : (
            <PaymentRows payments={payments.slice(0, 5)} state={state} now={now} />
          )}
        </section>
      </div>

      <aside className="space-y-5">
        <Tinted className="p-6">
          <div className="flex items-center gap-3">
            <Avatar name={guardian} size={54} tone="dark" />
            <p className="text-[18px] font-[800]">{guardianFull} is your guardian.</p>
          </div>
          <p className="mt-3">
            {guardian === "Your guardian" ? "They" : guardian} can stop a payment. {guardian === "Your guardian" ? "They" : guardian} can never move your money.
          </p>
        </Tinted>
        <Card title="How your money leaves">
          <ul className="space-y-3">
            <li className="flex gap-3">
              <Icon name="bolt" className="mt-0.5" />
              <span>
                <strong>Right away</strong>
                <span className="block text-[14px] text-ink-soft">Saved names, up to {money(lim.instantMax, usdc, 0)}</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Icon name="hourglass" className="mt-0.5" />
              <span>
                <strong>After {duration(state.coolOff)}</strong>
                <span className="block text-[14px] text-ink-soft">New recipients, or up to {money(lim.waitMax, usdc, 0)}. You confirm it once more.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Icon name="person" className="mt-0.5" />
              <span>
                <strong>Only if {guardian === "Your guardian" ? "your guardian" : guardian} approves</strong>
                <span className="block text-[14px] text-ink-soft">Anything larger</span>
              </span>
            </li>
          </ul>
          <Link to="/protection" className="mt-4 inline-block font-[700] underline-offset-4 hover:text-door hover:underline">
            Edit
          </Link>
        </Card>
        <QuantumCard compact />
        <div className="px-1 text-[14px]">
          <DeviceDots />
        </div>
      </aside>
    </div>
  );
}
