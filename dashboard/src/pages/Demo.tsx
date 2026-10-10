import { useState } from "react";
import { Link } from "react-router";
import { Gate } from "../components/Gate";
import { Icon } from "../components/Icon";
import { Button, Panel } from "../components/ui";
import { MOCK } from "../data/mock";
import { useSnapshot, useSource, useUsdc } from "../data/store";
import { amount, clock, money, short, toRaw } from "../lib/format";
import { phaseOf } from "../lib/phase";

const AMOUNT = "100";

interface Run {
  startedAt: number;
  balance: bigint;
  to: string;
  reqId: number | null;
  error: string | null;
}

export function Demo() {
  const source = useSource();
  const usdc = useUsdc();
  const { state, payments, requests, now } = useSnapshot();
  const [to, setTo] = useState<string>(MOCK.strangers[0]);
  const [custom, setCustom] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const raw = toRaw(AMOUNT, usdc) ?? 0n;
  const current = BigInt(state.balances.usdc);

  async function start() {
    const target = custom.trim() || to;
    const r: Run = { startedAt: now, balance: current, to: target, reqId: null, error: null };
    setRun(r);
    try {
      const req = await source.requestPayment(target, usdc, raw.toString());
      setRun({ ...r, reqId: req.reqId });
    } catch (e) {
      setRun({ ...r, error: (e as Error).message });
    }
  }

  const elapsed = run ? now - run.startedAt : 0;
  const gone = run !== null && elapsed >= 3;
  const ordinaryBalance = run === null ? current : gone ? run.balance - raw : run.balance;

  const req = run?.reqId != null ? requests.find((r) => r.reqId === run.reqId) : undefined;
  const pay = req?.paymentId !== undefined ? payments.find((p) => p.id === req.paymentId) : undefined;
  const ph = pay ? phaseOf(pay, state, now) : null;

  let right;
  if (!run) {
    right = <Gate tone="safe" icon="shield" word="Protected" caption="Same owner, same call." seam />;
  } else if (run.error || req?.status === "failed" || req?.status === "rejected") {
    right = <Gate tone="quiet" icon="cross" word="Not sent" caption={run.error ?? req?.reason ?? "Rejected on the puck."} />;
  } else if (!pay || !ph) {
    right = <Gate tone="door" icon="key" word="On the puck" caption="She reads the amount and name on the device, then signs." pulse />;
  } else {
    const end = ph.until ?? now;
    right = (
      <Gate
        tone={ph.tone}
        icon={ph.icon}
        word={ph.word}
        big={ph.live && ph.until ? clock(ph.until - now) : undefined}
        progress={ph.live ? (end > pay.proposedAt ? (now - pay.proposedAt) / (end - pay.proposedAt) : 1) : null}
        pulse={ph.key === "due" || ph.key === "confirm_now" || ph.key === "needs_guardian"}
      >
        <Link to={`/payments/${pay.id}`} className="mt-3 text-[0.95rem] font-[700] text-ink underline decoration-ink/25 underline-offset-4">
          Payment #{pay.id}
        </Link>
      </Gate>
    );
  }

  return (
    <div>
      <div className="mb-8 max-w-4xl">
        <p className="text-lg text-ink-soft">The call (an illustrative story)</p>
        <p className="mt-1 text-[clamp(1.6rem,3.2vw,2.6rem)] leading-tight font-[800]">
          "Mama, it's me. I'm in trouble. Send {AMOUNT} dollars now, and don't tell anyone."
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="flex flex-col p-6">
          <h2 className="text-[22px] font-[800]">An ordinary wallet</h2>
          <p className="text-ink-soft">Illustration only. One tap, and it's on its way.</p>
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <p className="text-ink-soft">Balance</p>
            <p className={`tabular text-[clamp(3rem,6vw,5rem)] leading-none font-[800] transition-colors ${gone ? "text-stop" : ""}`}>{amount(ordinaryBalance, usdc)}</p>
            <p className="font-[800] text-ink-soft">USDC</p>
            {run && (
              <p className={`arrive mt-8 flex items-center gap-2 text-2xl font-[700] ${gone ? "text-stop" : "text-ink-soft"}`}>
                <Icon name={gone ? "warn" : "send"} size={26} strokeWidth={2.4} />
                {gone ? `${money(raw, usdc)} gone in 3 seconds. No one else knew.` : "Sending…"}
              </p>
            )}
          </div>
        </Panel>

        <Panel className="flex flex-col p-6">
          <h2 className="text-[22px] font-[800]">Hisn</h2>
          <p className="text-ink-soft">{source.kind === "mock" ? "Simulated vault, same rules as the contract." : "The real vault on Hedera testnet."}</p>
          <div className="mx-auto w-full max-w-[300px] py-6">{right}</div>
          {pay && ph?.live && <p className="text-center text-lg">The alarm light is beeping. Her son can press stop.</p>}
        </Panel>
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-4">
        <fieldset>
          <legend className="mb-2 font-[700]">Recipient, chosen by a judge</legend>
          <div className="flex flex-wrap gap-2">
            {MOCK.strangers.map((s, i) => (
              <label key={s} className={`cursor-pointer rounded-input border-2 px-3 py-2 ${to === s && !custom ? "border-door bg-door-wash" : "border-line bg-paper"}`}>
                <input type="radio" name="to" className="sr-only" checked={to === s && !custom} onChange={() => { setTo(s); setCustom(""); }} />
                <span className="font-[700]">QR {i + 1}</span> <span className="font-mono text-sm text-ink-soft">{short(s)}</span>
              </label>
            ))}
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="or paste an address"
              aria-label="Recipient address"
              className="rounded-input border-2 border-line bg-paper px-3 py-2 font-mono text-sm focus:border-door focus:outline-none"
            />
          </div>
        </fieldset>
        <Button big icon="send" onClick={start} disabled={run !== null && !gone}>
          {run ? "Run it again" : `Send ${AMOUNT} USDC on both`}
        </Button>
        {run && (
          <Button look="plain" onClick={() => setRun(null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
