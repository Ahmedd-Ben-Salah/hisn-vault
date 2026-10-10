import { useState } from "react";
import { HBAR, type ChangeView } from "@hisn/shared";
import { Icon } from "../components/Icon";
import { StatusChip } from "../components/Status";
import { Button, Empty, PageTitle, Panel, Section } from "../components/ui";
import { QuantumCard } from "../components/QuantumCard";
import { MOCK } from "../data/mock";
import { useSnapshot, useSource, useUsdc } from "../data/store";
import { clock, dateTime, duration, money } from "../lib/format";
import { useNames } from "../lib/people";
import { CHANGE_WORDS, changePhaseOf } from "../lib/phase";

const FIELD_WORDS: Record<string, string> = {
  token: "Currency",
  instantMax: "Instant up to",
  waitMax: "Waiting total",
  dailyCap: "Instant total",
  agentDailyMax: "Helper allowance",
  seconds: "Seconds",
  address: "Address",
  label: "Saved name",
  newPuck: "New puck",
};

function ChangeCard({ c }: { c: ChangeView }) {
  const source = useSource();
  const { state, now } = useSnapshot();
  const { nameOf } = useNames();
  const ph = changePhaseOf(c, state, now);
  const [msg, setMsg] = useState<string | null>(null);
  async function apply() {
    try {
      await source.applyChange(c.id);
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-[800]">{CHANGE_WORDS[c.kind]}</p>
          <p className="text-sm text-ink-soft">
            Proposed by {nameOf(c.proposer, state)}
            {c.approver && <> · approved by {nameOf(c.approver, state)}</>}
          </p>
        </div>
        <StatusChip tone={ph.tone} icon={ph.icon} word={ph.word} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {Object.entries(c.fields).map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-ink-soft">{FIELD_WORDS[k] ?? k}</dt>
            <dd className="font-[700] break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4">
        {ph.until && (
          <p className="tabular">
            {ph.word === "Waiting" ? "Can apply in" : "Ends in"} <strong className="text-2xl font-[800]">{clock(ph.until - now)}</strong>
          </p>
        )}
        {ph.canApply && (
          <Button icon="bolt" onClick={apply}>
            Apply now
          </Button>
        )}
        {msg && <p className="font-[700] text-stop">{msg}</p>}
      </div>
    </Panel>
  );
}

const INPUT = "w-full rounded-input border-2 border-line bg-paper px-3 py-2 focus:border-door focus:outline-none";

function AskPuck() {
  const source = useSource();
  const { state, changeRequests } = useSnapshot();
  const [kind, setKind] = useState<"ADD_PAYEE" | "SET_COOLOFF">("ADD_PAYEE");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const req = mine !== null ? changeRequests.find((c) => c.reqId === mine) : undefined;
  const minMinutes = Math.ceil(state.immutables.minCoolOff / 60);

  async function submit() {
    setError(null);
    let fields: Record<string, string>;
    if (kind === "ADD_PAYEE") {
      const a = address.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return setError("Enter a full address: 0x followed by 40 letters and numbers.");
      if (state.payees.some((p) => p.address.toLowerCase() === a.toLowerCase())) return setError("That address is already saved.");
      const name = label.trim();
      if (!name) return setError("Give the name the puck will show, up to 16 letters.");
      if (!/^[ -~]{1,16}$/.test(name)) return setError("Up to 16 plain letters, numbers or spaces, so the puck can show it.");
      fields = { address: a, label: name };
    } else {
      const m = Number(minutes);
      if (!Number.isFinite(m) || m < minMinutes || m > 7 * 24 * 60) return setError(`Between ${minMinutes} minute${minMinutes === 1 ? "" : "s"} and 7 days.`);
      fields = { seconds: String(Math.round(m * 60)) };
    }
    try {
      const r = await source.requestChange(kind, fields);
      setMine(r.reqId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Panel className="p-5">
      <h3 className="text-lg font-[800]">Ask the puck for a change</h3>
      <p className="mt-1 text-sm text-ink-soft">The puck shows the change on its own screen. After you sign it, it waits {duration(state.immutables.settingsDelay)} and needs a guardian's yes.</p>
      <div className="mt-4 inline-flex rounded-input border-2 border-line bg-paper p-1" role="radiogroup" aria-label="Change">
        {(
          [
            ["ADD_PAYEE", "Save a new name"],
            ["SET_COOLOFF", "Change the cool-off"],
          ] as const
        ).map(([k, word]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1.5 font-[700] ${kind === k ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
          >
            {word}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {kind === "ADD_PAYEE" ? (
          <>
            <label className="block">
              <span className="text-sm font-[700]">Address</span>
              <input className={`${INPUT} font-mono text-[0.95rem]`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} />
            </label>
            <label className="block">
              <span className="text-sm font-[700]">Name on the puck</span>
              <input className={INPUT} value={label} maxLength={16} onChange={(e) => setLabel(e.target.value)} placeholder="Tunisie Telecom" />
            </label>
            <p className="text-sm text-ink-soft">
              {state.immutables.probation === 0
                ? "In this demo, small payments to a new name can go at once after the change applies."
                : `New names wait ${duration(state.immutables.probation)} before small payments to them can go at once.`}
            </p>
          </>
        ) : (
          <label className="block">
            <span className="text-sm font-[700]">Cool-off in minutes</span>
            <input className={`${INPUT} max-w-[10rem] tabular`} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder={String(Math.max(minMinutes, Math.round(state.coolOff / 60)))} />
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button icon="key" onClick={submit} disabled={req?.status === "waiting_puck"}>
          Send to the puck
        </Button>
        {error && <p className="font-[700] text-stop">{error}</p>}
        {req && !error && (
          <p className={`font-[700] ${req.status === "failed" || req.status === "rejected" ? "text-stop" : req.status === "proposed" ? "text-safe" : "text-hold"}`}>
            {req.status === "waiting_puck" && "Look at the puck and sign it there."}
            {req.status === "proposed" && `Signed. Change #${req.changeId ?? ""} is now waiting below.`}
            {req.status === "rejected" && "Rejected on the puck."}
            {req.status === "failed" && (req.reason ?? "The vault did not accept it.")}
          </p>
        )}
      </div>
    </Panel>
  );
}

function LimitTable() {
  const { state } = useSnapshot();
  const usdc = useUsdc();
  const rows: Array<[string, string, keyof typeof state.limits.usdc]> = [
    ["Goes at once, per payment", "Up to this, to a saved name", "instantMax"],
    ["Goes at once, in total", "Today and yesterday together", "dailyCap"],
    ["Can wait, in total", "Anything over this needs a guardian", "waitMax"],
    ["Helper's allowance", "Saved names only, today and yesterday", "agentDailyMax"],
  ];
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line text-sm text-ink-soft">
            <th className="px-5 py-3 font-[700]">Rule</th>
            <th className="px-5 py-3 text-right font-[700]">USDC</th>
            <th className="px-5 py-3 text-right font-[700]">HBAR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([title, sub, key]) => (
            <tr key={key}>
              <td className="px-5 py-3">
                <p className="font-[700]">{title}</p>
                <p className="text-sm text-ink-soft">{sub}</p>
              </td>
              <td className="px-5 py-3 text-right tabular-nums text-xl font-[800]">{money(state.limits.usdc[key], usdc, 0)}</td>
              <td className="px-5 py-3 text-right tabular-nums text-xl font-[800]">{money(state.limits.hbar[key], HBAR, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function Rules() {
  const source = useSource();
  const { state, changes, now } = useSnapshot();
  const im = state.immutables;
  const fixed: Array<[string, string]> = [
    ["Shortest cool-off", duration(im.minCoolOff)],
    ["Wait before a rule change", duration(im.settingsDelay)],
    ["Wait before replacing a lost puck", duration(im.recoveryDelay)],
    ["How long a waiting payment stays alive", duration(im.approvalWindow)],
    ["Longest freeze without renewal", duration(im.freezeMax)],
    ["New saved name, before it can be paid at once", im.probation === 0 ? "No wait (demo)" : duration(im.probation)],
    ["Most payments waiting at once", String(im.maxPending)],
  ];
  const open = changes.filter((c) => c.status === "PENDING" && c.keyEpoch === state.keyEpoch && now <= c.expiresAt);
  const past = changes.filter((c) => !open.includes(c));
  const sim = source.sim;

  return (
    <div>
      <PageTitle title="Protection" lead="How your money leaves, and what slows it down. Our server cannot move or block your money." />

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="mb-3 text-[22px] font-[800]">Limits</h2>
          <LimitTable />
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-[22px] font-[800]">Cool-off</h2>
            <Panel className="p-5">
              <p className="tabular-nums text-5xl font-[800]">{duration(state.coolOff)}</p>
              <p className="mt-2 text-ink-soft">How long a bigger or new payment waits. One minute here for the demo; hours in real life.</p>
            </Panel>
          </div>
          <div>
            <h2 className="mb-3 text-[22px] font-[800]">Freeze</h2>
            <Panel className="p-5">
              {state.frozenUntil > now ? (
                <>
                  <StatusChip tone="ice" icon="snow" word="Frozen" />
                  <p className="mt-2">
                    Ends by itself in <strong className="tabular">{clock(state.frozenUntil - now)}</strong>, at {dateTime(state.frozenUntil)}.
                  </p>
                </>
              ) : (
                <>
                  <StatusChip tone="safe" icon="shield" word="Not frozen" />
                  <p className="mt-2 text-ink-soft">
                    The puck, a guardian or the alarm light can freeze everything. It lasts {duration(im.freezeMax)} unless a different person renews it.
                  </p>
                </>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt-10 max-w-2xl">
        <QuantumCard />
      </div>
      <Section title="Fixed forever">
        <Panel>
          <ul className="divide-y divide-line">
            {fixed.map(([k, v]) => (
              <li key={k} className="flex items-center gap-3 px-5 py-3">
                <Icon name="lock" size={18} className="text-ink-soft" />
                <span className="flex-1">{k}</span>
                <span className="font-[700] tabular-nums">{v}</span>
                <span className="hidden text-sm text-ink-soft sm:inline">Cannot be changed</span>
              </li>
            ))}
          </ul>
        </Panel>
        <p className="mt-2 max-w-[70ch] text-sm text-ink-soft">
          These are written into the contract when it is created. There is no setting, admin key or upgrade that can shorten them.
        </p>
      </Section>

      <Section
        title="Rule changes"
        aside={
          sim?.kind === "mock" && (
            <Button look="quiet" icon="person" onClick={() => sim.proposeChange("RECOVER_PUCK", { newPuck: MOCK.strangers[2] })}>
              Simulate: guardian replaces a lost puck
            </Button>
          )
        }
      >
        <p className="mb-4 max-w-[70ch] text-ink-soft">
          Changes start on the puck, wait {duration(im.settingsDelay)}, and need a guardian's yes. Any guardian or the alarm light can stop one. A freeze or a key change wipes all waiting changes.
        </p>
        <div className="mb-6 max-w-xl">
          <AskPuck />
        </div>
        {open.length === 0 ? (
          <Empty icon="lock" title="No changes waiting" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {open.map((c) => (
              <ChangeCard key={c.id} c={c} />
            ))}
          </div>
        )}
        {past.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer font-[700] text-ink-soft">Earlier changes ({past.length})</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {past.map((c) => (
                <ChangeCard key={c.id} c={c} />
              ))}
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}
