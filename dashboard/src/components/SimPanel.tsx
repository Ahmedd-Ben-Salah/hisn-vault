import { useState, type ReactNode } from "react";
import { useSnapshot, useSource } from "../data/store";
import { money } from "../lib/format";
import { useNames } from "../lib/people";
import { CHANGE_WORDS, changePhaseOf, phaseOf } from "../lib/phase";
import { Icon } from "./Icon";

function Btn({ onClick, children, tone = "plain", disabled }: { onClick: () => void; children: ReactNode; tone?: "plain" | "stop" | "go"; disabled?: boolean }) {
  const look =
    tone === "stop"
      ? "bg-stop text-paper hover:bg-stop/90"
      : tone === "go"
        ? "bg-door text-paper hover:bg-door-deep"
        : "bg-plaster text-ink hover:bg-line";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`rounded-md px-2.5 py-1.5 text-sm font-[700] disabled:opacity-40 ${look}`}>
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <h3 className="mb-2 text-sm font-[700] text-ink-soft">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function SimPanel() {
  const source = useSource();
  const snap = useSnapshot();
  const { nameOf } = useNames();
  const [open, setOpenState] = useState(() => localStorage.getItem("hisn.sim") === "open");
  const setOpen = (v: boolean) => {
    localStorage.setItem("hisn.sim", v ? "open" : "closed");
    setOpenState(v);
  };
  const sim = source.sim;
  if (!sim) return null;
  const { state, now } = snap;
  const waitingReqs = snap.requests.filter((r) => r.status === "waiting_puck");
  const waitingChanges = snap.changeRequests.filter((c) => c.status === "waiting_puck");
  const devices = sim.kind === "devices";
  const live = snap.payments.map((p) => ({ p, ph: phaseOf(p, state, now) })).filter((x) => x.ph.live);
  const changes = snap.changes.filter((c) => changePhaseOf(c, state, now).word !== "Applied" && c.status === "PENDING" && c.keyEpoch === state.keyEpoch && now <= c.expiresAt);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-3 font-[700] text-paper shadow-lg"
      >
        <Icon name="split" size={18} />
        Simulator
        {waitingReqs.length + waitingChanges.length + live.length > 0 && (
          <span className="rounded-full bg-hold-fill px-2 text-sm text-ink">{waitingReqs.length + waitingChanges.length + live.length}</span>
        )}
      </button>
    );
  }

  return (
    <aside
      className="fixed right-4 bottom-4 z-40 flex max-h-[min(80dvh,720px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-card border border-ink/15 bg-paper shadow-[0_18px_50px_-12px_rgba(20,33,61,0.35)]"
      aria-label="Simulator"
    >
      <header className="flex items-start gap-3 bg-ink px-4 py-3 text-paper">
        <div className="flex-1">
          <h2 className="text-lg font-[800]">Simulator</h2>
          <p className="text-sm text-paper/75">
            {devices ? "Drives the device simulator: a real puck key and alarm light key, signing on the real vault." : "Stands in for the puck, the alarm light and the guardian's phone."}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-paper/10" aria-label="Hide simulator">
          <Icon name="cross" size={18} />
        </button>
      </header>
      <div className="overflow-y-auto">
        <section className="space-y-2 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span>Puck signs by itself after 3 s</span>
            <input type="checkbox" className="size-5 accent-door" checked={sim.autoPuck} onChange={(e) => sim.setAutoPuck(e.target.checked)} />
          </label>
          {sim.setServerOn ? (
            <label className="flex items-center justify-between gap-3">
              <span>
                Our server is <strong>{sim.serverOn ? "on" : "off"}</strong>
              </span>
              <input type="checkbox" className="size-5 accent-door" checked={sim.serverOn} onChange={(e) => sim.setServerOn?.(e.target.checked)} />
            </label>
          ) : (
            <p className="text-sm text-ink-soft">
              Our server is <strong className="text-ink">{sim.serverOn ? "connected" : "not answering"}</strong>. Stop the relayer process to show the network releasing payments on its own.
            </p>
          )}
        </section>

        {waitingReqs.length + waitingChanges.length > 0 && (
          <Group title="On the puck screen">
            {waitingChanges.map((c) => (
              <div key={`c${c.reqId}`}>
                <p className="text-sm">
                  <strong>{CHANGE_WORDS[c.kind]}</strong>
                  {c.label && <span className="text-ink-soft"> · {c.label}</span>}
                </p>
                <div className="mt-1 flex gap-2">
                  <Btn tone="go" onClick={() => sim.puckSignChange(c.reqId)}>
                    Hold to sign
                  </Btn>
                </div>
              </div>
            ))}
            {waitingReqs.map((r) => (
              <div key={r.reqId}>
                <p className="text-sm">
                  <strong>{money(r.amount, r.token)}</strong> to {nameOf(r.to, state)}
                  {r.source === "agent" && <span className="text-ink-soft"> (from the helper)</span>}
                </p>
                <div className="mt-1 flex gap-2">
                  <Btn tone="go" onClick={() => sim.puckSign(r.reqId)}>
                    Hold to sign
                  </Btn>
                  <Btn onClick={() => sim.puckReject(r.reqId)}>Reject</Btn>
                </div>
              </div>
            ))}
          </Group>
        )}

        {live.length > 0 && (
          <Group title="Waiting payments">
            {live.map(({ p, ph }) => (
              <div key={p.id}>
                <p className="text-sm">
                  <strong>#{p.id}</strong> {money(p.amount, p.token)} to {p.label ?? "new recipient"} · <span className="text-hold">{ph.word}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {p.tier === "WAIT" && !p.confirmed && (
                    <Btn tone="go" disabled={now < p.confirmFrom} onClick={() => sim.puckReconfirm(p.id)}>
                      {now < p.confirmFrom ? `Puck: confirm in ${p.confirmFrom - now}s` : "Puck: confirm again"}
                    </Btn>
                  )}
                  {p.tier === "APPROVAL" && !p.confirmed && (
                    <Btn tone="go" onClick={() => sim.guardianApprove(p.id)}>
                      Guardian: approve
                    </Btn>
                  )}
                  <Btn tone="stop" onClick={() => sim.guardianStop(p.id, "guardian")}>
                    Guardian: stop
                  </Btn>
                  <Btn tone="stop" onClick={() => sim.guardianStop(p.id, "watcher")}>
                    Light: stop
                  </Btn>
                  <Btn onClick={() => sim.puckCancel(p.id)}>Puck: cancel</Btn>
                </div>
              </div>
            ))}
          </Group>
        )}

        {changes.length > 0 && (
          <Group title="Waiting rule changes">
            {changes.map((c) => (
              <div key={c.id}>
                <p className="text-sm">
                  <strong>{CHANGE_WORDS[c.kind]}</strong>
                  {c.approver ? <span className="text-safe"> · approved</span> : c.needsApproval ? <span className="text-hold"> · needs a guardian</span> : null}
                </p>
                <div className="mt-1 flex gap-2">
                  {c.needsApproval && !c.approver && (
                    <Btn tone="go" onClick={() => sim.approveChange(c.id)}>
                      Guardian: approve
                    </Btn>
                  )}
                  <Btn tone="stop" onClick={() => sim.vetoChange(c.id)}>
                    Guardian: stop
                  </Btn>
                </div>
              </div>
            ))}
          </Group>
        )}

        <Group title="Freeze everything">
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => sim.freeze("puck")}>From the puck</Btn>
            <Btn onClick={() => sim.freeze("guardian")}>From the guardian</Btn>
            <Btn onClick={() => sim.freeze("watcher")}>From the light</Btn>
          </div>
        </Group>

        {sim.reset && (
          <Group title="Start over">
            <Btn onClick={() => sim.reset?.()}>Reset the simulation</Btn>
          </Group>
        )}
      </div>
    </aside>
  );
}
