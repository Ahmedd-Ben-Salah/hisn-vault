import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChangeKind, DEMO_USDC, HBAR, USDC_TESTNET, formatAmount, hashscanTx, type ChangeFields } from "@hisn/shared";
import type { Wallet } from "ethers";
import { liveActions, readView } from "./chain";
import { ON_HEDERA, SOURCE, focusPayment, loadConfig, saveConfig, type Config } from "./config";
import { importKey } from "./key";
import { Demo } from "./demo";
import { ROLE, STATUS, TIER, type Actions, type Chg, type Done, type Pay, type View } from "./model";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function useNow(): number {
  const [n, setN] = useState(nowSec());
  useEffect(() => {
    const t = setInterval(() => setN(nowSec()), 1000);
    return () => clearInterval(t);
  }, []);
  return n;
}

function money(amount: bigint, token: string): string {
  const isHbar = token.toLowerCase() === HBAR;
  const s = formatAmount(amount, isHbar ? 8 : 6, 2);
  const [w, f] = s.split(".");
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f} ${isHbar ? "HBAR" : [USDC_TESTNET, DEMO_USDC].some((u) => u.toLowerCase() === token.toLowerCase()) ? "USDC" : "tokens"}`;
}

function clock(s: number): string {
  const v = Math.max(0, s);
  const m = Math.floor(v / 60);
  return `${m}:${String(v % 60).padStart(2, "0")}`;
}

function time(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function Result({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const done = notice.done;
  return (
    <div className="arrive rounded-card bg-paper p-5 shadow-[0_10px_30px_-12px_rgba(20,33,61,0.35)]" role="status">
      <p className={`text-2xl font-[800] ${NOTICE_TONE[notice.tone]}`}>{notice.title}</p>
      {notice.lines.map((l) => (
        <p key={l} className="mt-2 text-lg">
          {l}
        </p>
      ))}
      <p className="mt-3 text-sm text-ink-soft">
        {done.path === "relayer" && "Signed on this phone and sent through the Hisn server."}
        {done.path === "direct" && `Signed on this phone and sent straight to ${ON_HEDERA ? "Hedera" : "the chain"}, without the Hisn server.`}
        {done.path === "demo" && "Demo only: nothing was sent to Hedera."}{" "}
        {done.tx && done.path !== "demo" && ON_HEDERA && (
          <a className="font-bold text-door underline" href={hashscanTx(done.tx)} target="_blank" rel="noreferrer">
            See it on HashScan
          </a>
        )}
      </p>
      <button type="button" onClick={onClose} className="mt-4 font-bold text-door">
        Close
      </button>
    </div>
  );
}

function Questions({ owner }: { owner: string }) {
  return (
    <ol className="mt-3 space-y-2 text-lg leading-snug">
      {[`Who asked you to pay?`, `Did anyone tell you to keep it secret, or tell you what to say?`, `Have you met this person?`].map((q, i) => (
        <li key={q} className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-bold text-paper">{i + 1}</span>
          <span>{q}</span>
        </li>
      ))}
      <li className="sr-only">Ask {owner} these three questions.</li>
    </ol>
  );
}

function SpokeTick({ owner, checked, onChange, extra }: { owner: string; checked: boolean; onChange: (v: boolean) => void; extra?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-card border-2 border-line bg-paper p-3 text-lg">
      <input type="checkbox" className="mt-1 size-6 shrink-0 accent-door" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        I spoke to {owner} on the usual number{extra ? `, ${extra}` : ""}.
      </span>
    </label>
  );
}

interface Notice {
  id: number;
  done: Done;
  tone: "stop" | "ice" | "safe" | "ink";
  title: string;
  lines: string[];
}

type Notify = (n: Omit<Notice, "id">) => void;

function useAction(notify: Notify): [string | null, Notice["tone"] | null, (f: () => Promise<Done>, title: string, tone: Notice["tone"], lines: string[]) => void] {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Notice["tone"] | null>(null);
  const run = (f: () => Promise<Done>, title: string, tone: Notice["tone"], lines: string[]) => {
    setBusy(tone);
    setErr(null);
    f()
      .then((done) => notify({ done, title, tone, lines }))
      .catch((e: unknown) => setErr((e as Error).message.slice(0, 200)))
      .finally(() => setBusy(null));
  };
  return [err, busy, run];
}

const NOTICE_TONE: Record<Notice["tone"], string> = { stop: "text-stop", ice: "text-ink", safe: "text-safe", ink: "text-ink" };

function goneText(p: Pay, owner: string): [string, string] {
  const what = `${money(p.amount, p.token)} to ${short(p.to)}`;
  switch (p.status) {
    case STATUS.EXECUTED:
      return [`Payment ${p.id} has already left.`, `${what} was sent. If ${owner} did not mean it, call ${owner} now on the usual number.`];
    case STATUS.VETOED:
      return [`Payment ${p.id} was stopped.`, `${what} did not leave ${owner}'s account.`];
    case STATUS.CANCELLED:
      return [`Payment ${p.id} was cancelled.`, `${what} did not leave ${owner}'s account.`];
    case STATUS.EXPIRED:
      return [`Payment ${p.id} ended without ${owner}'s second yes.`, `${what} did not leave ${owner}'s account.`];
    default:
      return [`There is no payment ${p.id} in ${owner}'s vault.`, "Check the link you opened."];
  }
}

function GoneNotice({ p, owner, onClose }: { p: Pay; owner: string; onClose: () => void }) {
  const [title, line] = goneText(p, owner);
  return (
    <section className="arrive rounded-2xl bg-paper p-5 shadow-[0_10px_30px_-12px_rgba(20,33,61,0.35)]" role="status">
      <p className="text-sm font-bold text-ink-soft">The link you opened</p>
      <p className={`mt-1 font-wide text-2xl font-[800] ${p.status === STATUS.EXECUTED ? "text-hold" : "text-ink"}`}>{title}</p>
      <p className="mt-2 text-lg">{line}</p>
      <button type="button" onClick={onClose} className="mt-4 font-bold text-door">
        Show everything
      </button>
    </section>
  );
}

function PaymentAlert({ p, owner, act, now, notify, focused = false }: { p: Pay; owner: string; act: Actions; now: number; notify: Notify; focused?: boolean }) {
  const [spoke, setSpoke] = useState(false);
  const [err, busy, run] = useAction(notify);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focused]);
  const approval = p.tier === TIER.APPROVAL;
  const what = money(p.amount, p.token);
  const until = approval ? (p.confirmed ? p.releaseAt : p.expiresAt) : p.confirmed ? p.releaseAt : p.expiresAt;
  return (
    <article
      ref={box}
      className={`arrive scroll-mt-4 overflow-hidden rounded-card bg-paper shadow-[0_10px_30px_-12px_rgba(20,33,61,0.35)] ${focused ? "ring-4 ring-door" : ""}`}
      aria-label={`Payment ${p.id}`}
      aria-current={focused ? "true" : undefined}
    >
      <div className="gate-pulse h-2 bg-hold-fill" aria-hidden="true" />
      <div className="p-5">
        <p className="text-[1.6rem] leading-tight font-[800]">
          {owner} is sending {money(p.amount, p.token)} to {p.isPayee ? "a saved name" : "someone new, never paid before"}.
        </p>
        <p className="mt-2 font-display text-lg text-ink-soft">
          {approval
            ? p.confirmed
              ? `Approved. Leaves in ${clock(until - now)}.`
              : `Nothing moves without a guardian's yes. Ends in ${clock(until - now)}.`
            : p.confirmed
              ? `${owner} confirmed it again. Leaves in ${clock(until - now)} unless you stop it.`
              : now < p.confirmFrom
                ? `${owner} can confirm it again from ${time(p.confirmFrom)}. Until then it cannot leave.`
                : `Waiting for ${owner}'s second yes on the puck. Ends at ${time(p.expiresAt)}.`}
        </p>
        <p className="mt-5 rounded-card bg-hold-wash p-4 text-xl leading-snug font-bold text-hold">
          Call {owner} now on the usual number. Hisn never calls you.
        </p>
        <Questions owner={owner} />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(() => act.stop(p), "Stopped.", "stop", [
              `${what} did not leave ${owner}'s account.`,
              "Stopping is a pause, not an accusation. Nobody can recover money for a fee.",
            ])
          }
          className="mt-6 w-full rounded-card bg-stop py-6 text-3xl font-[800] text-paper active:scale-[0.99] disabled:opacity-60"
        >
          {busy === "stop" ? "Stopping…" : "Stop payment"}
        </button>
        {approval && !p.confirmed && (
          <div className="mt-5 space-y-3">
            <SpokeTick owner={owner} checked={spoke} onChange={setSpoke} />
            <button
              type="button"
              disabled={!spoke || busy !== null}
              onClick={() => run(() => act.approve(p), "Approved.", "safe", [`${what} leaves after the cool-off. You can still stop it until then.`])}
              className="w-full rounded-card border-2 border-ink/20 py-3 text-lg font-bold disabled:opacity-40"
            >
              {busy === "safe" ? "Approving…" : "Approve"}
            </button>
          </div>
        )}
        {!approval && (
          <p className="mt-4 text-ink-soft">Only {owner}'s second yes on her puck releases it. You can stop it.</p>
        )}
        {err && <p className="mt-3 font-bold text-stop">Could not send: {err}</p>}
        <p className="mt-4 font-mono text-sm break-all text-ink-soft">To {p.to}</p>
      </div>
    </article>
  );
}

function describe(fields: ChangeFields | null, kind: number): string {
  if (!fields) return "A rule change the page could not read. Stop it if you are unsure.";
  switch (fields.kind) {
    case ChangeKind.UNFREEZE:
      return "End the freeze early.";
    case ChangeKind.SET_COOLOFF:
      return `Change the cool-off to ${fields.seconds.toString()} seconds.`;
    case ChangeKind.SET_LIMITS:
      return `New limits: instant up to ${money(fields.instantMax, fields.token)}, waiting total ${money(fields.waitMax, fields.token)}, helper ${money(fields.agentDailyMax, fields.token)}.`;
    case ChangeKind.ADD_PAYEE:
      return `Save a new name for ${short(fields.address)}, so small payments to it go at once.`;
    case ChangeKind.REMOVE_PAYEE:
      return `Remove the saved name ${short(fields.address)}.`;
    case ChangeKind.SET_AGENT:
      return `Change the helper's key to ${short(fields.address)}.`;
    case ChangeKind.ADD_GUARDIAN:
      return `Add a guardian: ${short(fields.address)}.`;
    case ChangeKind.REMOVE_GUARDIAN:
      return `Remove the guardian ${short(fields.address)}.`;
    case ChangeKind.ADD_WATCHER:
      return `Add an alarm light: ${short(fields.address)}.`;
    case ChangeKind.REMOVE_WATCHER:
      return `Remove the alarm light ${short(fields.address)}.`;
    case ChangeKind.RECOVER_PUCK:
      return `Replace the puck with a new one: ${short(fields.address)}.`;
    default:
      return `Change of kind ${kind}.`;
  }
}

function ChangeAlert({ c, owner, act, now, me, notify }: { c: Chg; owner: string; act: Actions; now: number; me: string; notify: Notify }) {
  const [spoke, setSpoke] = useState(false);
  const [err, busy, run] = useAction(notify);
  const recovery = c.kind === ChangeKind.RECOVER_PUCK;
  const approved = c.approver !== "0x0000000000000000000000000000000000000000";
  const mine = c.proposer.toLowerCase() === me.toLowerCase();
  return (
    <article className={`arrive overflow-hidden rounded-card bg-paper shadow-[0_10px_30px_-12px_rgba(20,33,61,0.35)] ${recovery ? "ring-4 ring-stop" : ""}`}>
      <div className={`h-2 ${recovery ? "gate-pulse bg-stop" : "bg-door"}`} aria-hidden="true" />
      <div className="p-5">
        {recovery ? (
          <>
            <p className="text-[1.6rem] leading-tight font-[800] text-stop">Someone is trying to replace {owner}'s puck.</p>
            <p className="mt-2 text-lg">If {owner} did not lose it, stop this now. Call {owner} on the usual number first.</p>
          </>
        ) : (
          <p className="text-[1.4rem] leading-tight font-[800]">{owner}'s rules are about to change.</p>
        )}
        <p className="mt-3 text-lg">{describe(c.fields, c.kind)}</p>
        <p className="mt-2 font-display text-ink-soft">
          {now < c.readyAt ? `Can take effect in ${clock(c.readyAt - now)}` : "Can take effect now"}
          {approved ? ", already approved by a guardian." : ", if a guardian approves."}
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run(() => act.stopChange(c), "Change stopped.", "stop", [`${owner}'s rules stay as they were.`])}
          className="mt-5 w-full rounded-card bg-stop py-5 text-2xl font-[800] text-paper disabled:opacity-60"
        >
          {busy === "stop" ? "Stopping…" : "Stop this change"}
        </button>
        {!approved && !mine && (
          <div className="mt-5 space-y-3">
            <SpokeTick owner={owner} checked={spoke} onChange={setSpoke} extra={recovery ? "and the puck is really lost" : undefined} />
            <button
              type="button"
              disabled={!spoke || busy !== null}
              onClick={() => run(() => act.approveChange(c), "Change approved.", "safe", ["It takes effect when its wait is over. Any guardian can still stop it until then."])}
              className="w-full rounded-card border-2 border-ink/20 py-3 text-lg font-bold disabled:opacity-40"
            >
              {busy === "safe" ? "Approving…" : "Approve the change"}
            </button>
          </div>
        )}
        {mine && <p className="mt-4 text-ink-soft">You started this. A different guardian has to approve it.</p>}
        {err && <p className="mt-3 font-bold text-stop">Could not send: {err}</p>}
      </div>
    </article>
  );
}

function FreezeBox({ view, act, now, me, owner, notify }: { view: View; act: Actions; now: number; me: string; owner: string; notify: Notify }) {
  const [confirming, setConfirming] = useState(false);
  const [err, busy, run] = useAction(notify);
  const frozen = view.frozenUntil > now;
  const iFroze = view.lastFreezer.toLowerCase() === me.toLowerCase() || view.lastFreezer === "me";
  if (frozen) {
    return (
      <section className="rounded-card bg-ice-wash p-5 text-ink">
        <p className="text-2xl font-[800]">Frozen</p>
        <p className="mt-1 text-lg">
          Nothing can leave until {time(view.frozenUntil)} ({clock(view.frozenUntil - now)} left).
        </p>
        {!iFroze ? (
          <button type="button" disabled={busy !== null} onClick={() => run(() => act.renewFreeze(), "Freeze renewed.", "ice", ["It ends by itself unless another person renews it again."])} className="mt-4 w-full rounded-card bg-ink py-3 text-lg font-bold text-paper">
            Keep it frozen longer
          </button>
        ) : (
          <p className="mt-3 text-ink/80">You froze it, so a different person has to renew it. One person cannot keep the account frozen alone.</p>
        )}
        {err && <p className="mt-3 font-bold text-stop">Could not send: {err}</p>}
      </section>
    );
  }
  return (
    <section className="rounded-card border-2 border-dashed border-ice/40 p-5">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="w-full text-left">
          <span className="block text-xl font-[800] text-ink">Freeze everything</span>
          <span className="mt-1 block text-ink-soft">Stops every waiting payment and blocks new ones for 10 minutes.</span>
        </button>
      ) : (
        <div>
          <p className="text-lg font-bold">Freeze {owner}'s whole account now?</p>
          <div className="mt-3 flex gap-3">
            <button type="button" disabled={busy !== null} onClick={() => {
                setConfirming(false);
                run(() => act.freeze(), "Frozen.", "ice", [`Nothing can leave ${owner}'s account. Every waiting payment was cancelled.`, "It ends by itself unless a different person renews it."]);
              }} className="flex-1 rounded-card bg-ink py-3 text-lg font-bold text-paper">
              {busy !== null ? "Freezing…" : "Yes, freeze"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-card border-2 border-line px-5 font-bold">
              No
            </button>
          </div>
          {err && <p className="mt-3 font-bold text-stop">Could not send: {err}</p>}
        </div>
      )}
    </section>
  );
}

function Setup({ cfg, wallet, view, demo }: { cfg: Config; wallet: Wallet; view: View; demo: Demo | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  function useExisting() {
    setImportError(null);
    try {
      const w = importKey(pasted);
      if (w.address === wallet.address) return setImportError("That is already this phone's key.");
      window.location.reload();
    } catch {
      setImportError("That is not a valid key: 64 letters and numbers, with or without 0x.");
    }
  }
  return (
    <section className="mt-10 border-t border-line pt-6">
      <p className="text-sm text-ink-soft">This phone's guardian address</p>
      <p className="mt-1 font-mono text-[0.95rem] break-all">{wallet.address}</p>
      <button
        type="button"
        className="mt-2 font-bold text-door"
        onClick={() => {
          void navigator.clipboard?.writeText(wallet.address).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy address"}
      </button>
      {view.mode === "live" && view.myRole !== ROLE.GUARDIAN && (
        <p className="mt-3 rounded-card bg-hold-wash p-3 font-bold text-hold">
          {view.myRole === ROLE.WATCHER ? "This key is an alarm light, not a guardian: it can stop and freeze but not approve." : `This key is not a guardian of the vault yet. Send the address above to ${cfg.owner} so it can be added.`}
        </p>
      )}
      <p className="mt-4 text-sm text-ink-soft">
        The key lives in this browser's storage. That is fine for a demo. A real product would keep it in the phone's secure storage or a passkey.
      </p>
      {demo && (
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => demo.addLarge()} className="rounded-input bg-plaster px-3 py-2 font-bold">
            Demo: a large payment
          </button>
          <button type="button" onClick={() => demo.addRecovery()} className="rounded-input bg-plaster px-3 py-2 font-bold">
            Demo: a puck replacement
          </button>
        </div>
      )}
      <button type="button" className="mt-6 font-bold text-door" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide settings" : "Settings"}
      </button>
      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            saveConfig({ vault: String(f.get("vault") ?? ""), relayer: String(f.get("relayer") ?? ""), relayerToken: String(f.get("relayerToken") ?? ""), owner: String(f.get("owner") ?? "") });
            window.location.reload();
          }}
        >
          {(
            [
              ["vault", "Vault address", cfg.vault],
              ["relayer", "Hisn server address (optional)", cfg.relayer],
              ["relayerToken", "Hisn server access key", cfg.relayerToken],
              ["owner", "Owner's first name", cfg.owner],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="block">
              <span className="text-sm font-bold">{label}</span>
              <input name={name} defaultValue={value} type={name === "relayerToken" ? "password" : "text"} autoComplete="off" className="mt-1 w-full rounded-input border-2 border-line bg-paper px-3 py-2 font-mono text-sm" />
            </label>
          ))}
          <button type="submit" className="rounded-full bg-door px-4 py-2 font-bold text-paper">
            Save
          </button>
          <div>
            <button type="button" className="text-sm font-bold text-stop" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide backup key" : "Show backup key"}
            </button>
            {showKey && <p className="mt-1 font-mono text-xs break-all text-stop">{wallet.privateKey}</p>}
          </div>
        </form>
      )}
      {open && (
        <div className="mt-6 space-y-2 border-t border-line pt-4">
          <label className="block">
            <span className="text-sm font-bold">Use an existing key</span>
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              className="mt-1 w-full rounded-input border-2 border-line bg-paper px-3 py-2 font-mono text-sm"
            />
          </label>
          <p className="text-sm text-ink-soft">This replaces the key on this phone. Show and save the backup key above first if the current address matters.</p>
          <button type="button" disabled={!pasted.trim()} onClick={useExisting} className="rounded-full bg-ink px-4 py-2 font-bold text-paper disabled:opacity-40">
            Use this key
          </button>
          {importError && <p className="font-bold text-stop">{importError}</p>}
        </div>
      )}
    </section>
  );
}

export function App({ wallet }: { wallet: Wallet }) {
  const cfg = useMemo(loadConfig, []);
  const demo = useMemo(() => (cfg.vault ? null : new Demo()), [cfg.vault]);
  const now = useNow();
  const [focus, setFocus] = useState(() => focusPayment(window.location.search));
  const [live, setLive] = useState<View | null>(null);
  const demoView = useSyncExternalStore(
    (l) => (demo ? demo.subscribe(l) : () => void 0),
    () => (demo ? demo.view() : null),
  );

  useEffect(() => {
    if (demo) {
      const t = setInterval(() => demo.tick(), 1000);
      return () => clearInterval(t);
    }
    let alive = true;
    const load = () =>
      readView(cfg, wallet.address, focus)
        .then((v) => alive && setLive(v))
        .catch((e: unknown) => alive && setLive((prev) => (prev ? { ...prev, error: (e as Error).message } : null)));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cfg, wallet, demo, focus]);

  const unfocus = useCallback(() => {
    setFocus(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    window.history.replaceState(null, "", url);
  }, []);

  const view = demo ? demoView : live;
  const viewRef = useRef<View | null>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const act: Actions | null = useMemo(() => {
    if (demo) return demo.actions();
    return liveActions(cfg, wallet, () => viewRef.current as View);
  }, [demo, cfg, wallet, viewRef]);

  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback<Notify>((n) => setNotices((list) => [{ ...n, id: Date.now() + Math.random() }, ...list].slice(0, 4)), []);
  const alarms = view ? view.pending.length + view.changes.length : 0;
  useEffect(() => {
    document.title = alarms > 0 ? `(${alarms}) Hisn guardian` : "Hisn guardian";
  }, [alarms]);

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center gap-3 py-3">
        <svg viewBox="0 0 100 100" width={30} height={30} aria-hidden="true">
          <rect x="16" y="12" width="22" height="76" rx="6" fill="var(--ink)" />
          <rect x="36" y="40" width="28" height="18" fill="var(--ink)" />
          <rect x="62" y="12" width="22" height="52" rx="6" fill="var(--ink)" />
          <rect x="62" y="74" width="22" height="14" rx="5" fill="var(--accent)" />
        </svg>
        <div className="flex-1">
          <p className="flex items-center gap-2 text-[26px] leading-none font-[900] tracking-tight">
            hisn <span className="rounded-full bg-soft px-3 py-1 text-[13px] font-[800] tracking-normal">Guardian</span>
          </p>
          <p className="mt-1 text-ink-soft">You look after {cfg.owner}'s account</p>
        </div>
      </header>
      {view?.mode === "demo" && (
        <p className="mb-4 rounded-input border border-dashed border-ink-soft/50 px-3 py-2 text-sm text-ink-soft">
          <strong className="text-ink">Demo.</strong> No vault is set, so this page shows a pretend payment. Nothing is sent to Hedera.
        </p>
      )}
      {view?.error && (
        <p className="mb-4 rounded-input bg-stop-wash px-3 py-2 font-bold text-stop">Cannot reach {SOURCE}. Showing what was last seen at {time(view.checkedAt)}.</p>
      )}
      {!view ? (
        <p className="py-16 text-center text-lg text-ink-soft">Reading {cfg.owner}'s vault from Hedera…</p>
      ) : (
        <main className="space-y-5">
          {notices.map((n) => (
            <Result key={n.id} notice={n} onClose={() => setNotices((list) => list.filter((x) => x.id !== n.id))} />
          ))}
          {focus !== null && view.gone?.id === focus && <GoneNotice p={view.gone} owner={cfg.owner} onClose={unfocus} />}
          {view.changes
            .filter((c) => c.kind === ChangeKind.RECOVER_PUCK)
            .map((c) => act && <ChangeAlert key={`c${c.id}`} c={c} owner={cfg.owner} act={act} now={now} me={wallet.address} notify={notify} />)}
          {[...view.pending]
            .sort((a, b) => Number(b.id === focus) - Number(a.id === focus))
            .map((p) => act && <PaymentAlert key={`p${p.id}`} p={p} owner={cfg.owner} act={act} now={now} notify={notify} focused={p.id === focus} />)}
          {view.changes
            .filter((c) => c.kind !== ChangeKind.RECOVER_PUCK)
            .map((c) => act && <ChangeAlert key={`c${c.id}`} c={c} owner={cfg.owner} act={act} now={now} me={wallet.address} notify={notify} />)}
          {alarms === 0 && notices.length === 0 && view.frozenUntil <= now && (
            <section className="rounded-card bg-safe-wash p-6 text-safe">
              <p className="text-3xl font-[800]">All quiet</p>
              <p className="mt-2 text-lg text-ink">
                You will see an alarm here when {cfg.owner} sends a bigger payment, pays someone new, or a rule is about to change.
              </p>
            </section>
          )}
          {act && <FreezeBox view={view} act={act} now={now} me={wallet.address} owner={cfg.owner} notify={notify} />}
          <p className="text-center text-sm text-ink-soft">
            {view.mode === "live" ? `Read from ${SOURCE} at ${new Date(view.checkedAt * 1000).toLocaleTimeString()}. Checks every 5 seconds.` : "Demo data."}
          </p>
        </main>
      )}
      {view && <Setup cfg={cfg} wallet={wallet} view={view} demo={demo} />}
    </div>
  );
}
