import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { HBAR, Tier, predictTier } from "@hisn/shared";
import { Icon } from "../components/Icon";
import { AddressText, Avatar, Button, ButtonLink, Card, Fact, PageTitle, Tinted } from "../components/ui";
import { useSnapshot, useSource, useUsdc } from "../data/store";
import { amount, duration, money, short, toRaw } from "../lib/format";
import { useNames } from "../lib/people";
import { limitBig, windowsFor } from "../lib/windows";

type Who = { kind: "saved"; address: string } | { kind: "new" };

const PUCK_TIMEOUT_MS = 120_000;

export function Send() {
  const source = useSource();
  const usdc = useUsdc();
  const navigate = useNavigate();
  const { nameOf } = useNames();
  const { state, payments, requests, now } = useSnapshot();
  const [who, setWho] = useState<Who>(() => (state.payees[0] ? { kind: "saved", address: state.payees[0].address } : { kind: "new" }));
  const [newAddress, setNewAddress] = useState("");
  const [symbol, setSymbol] = useState<"USDC" | "HBAR">("USDC");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reqId, setReqId] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const guardian = (state.guardians[0] ? nameOf(state.guardians[0], state) : "your guardian").split(",")[0];
  const tokenAddr = symbol === "USDC" ? usdc : HBAR;
  const to = who.kind === "saved" ? who.address : newAddress.trim();
  const validTo = /^0x[0-9a-fA-F]{40}$/.test(to);
  const raw = toRaw(value, tokenAddr);
  const payee = state.payees.find((p) => p.address.toLowerCase() === to.toLowerCase());
  const isKey = [state.puck, ...state.guardians, ...state.watchers, state.agent ?? ""].some((k) => k && k.toLowerCase() === to.toLowerCase());
  const balance = BigInt(symbol === "USDC" ? state.balances.usdc : state.balances.hbar);
  const spendable = symbol === "HBAR" ? balance - BigInt(state.gasReserve) : balance;

  const guess = useMemo(() => {
    if (!raw || raw <= 0n || !validTo) return null;
    const lim = limitBig(symbol === "USDC" ? state.limits.usdc : state.limits.hbar);
    const w = windowsFor(payments, tokenAddr, now);
    return predictTier({
      amount: raw,
      isPayee: !!payee,
      pastProbation: !!payee && now - payee.since >= state.immutables.probation,
      vaultBalance: balance,
      instantSpent2d: w.instant,
      waitQueued2d: w.waiting,
      limits: lim,
    });
  }, [raw, validTo, symbol, state, payments, tokenAddr, now, payee, balance]);

  // The rule level comes from the backend (POST /tier). The local guess is only shown until it answers, or in mock mode.
  const [checked, setChecked] = useState<{ key: string; tier: Tier } | null>(null);
  const checkKey = raw && raw > 0n && validTo ? `${to.toLowerCase()}|${tokenAddr}|${raw.toString()}|${payments.length}` : "";
  useEffect(() => {
    if (!checkKey || !source.previewTier || source.kind !== "live") return;
    let alive = true;
    const t = setTimeout(() => {
      const [addr, tok, amt] = checkKey.split("|");
      source
        .previewTier!(addr, tok, amt)
        .then((name) => {
          if (alive) setChecked({ key: checkKey, tier: Tier[name] });
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [checkKey, source]);
  const fromVault = checked !== null && checked.key === checkKey;
  const preview = fromVault ? checked.tier : guess;

  const req = reqId !== null ? requests.find((r) => r.reqId === reqId) : undefined;
  const frozen = state.frozenUntil > now;
  const tooMany = state.immutables.maxPending > 0 && state.pendingCount >= state.immutables.maxPending && preview !== null && preview !== Tier.INSTANT;
  const timedOut = req?.status === "waiting_puck" && sentAt > 0 && now * 1000 - sentAt > PUCK_TIMEOUT_MS;

  useEffect(() => {
    if (req?.status === "proposed" && req.paymentId !== undefined) navigate(`/payments/${req.paymentId}`);
  }, [req, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDismissed(false);
    if (!validTo) return setError("Enter a full address: 0x followed by 40 letters and numbers.");
    if (isKey) return setError("That address belongs to a puck, guardian, alarm light or the helper. It can never receive money.");
    if (!raw || raw <= 0n) return setError("Enter an amount above zero.");
    if (raw > spendable) return setError(`You have ${money(spendable, tokenAddr)} you can send.`);
    setBusy(true);
    try {
      const r = await source.requestPayment(to, tokenAddr, raw.toString());
      setReqId(r.reqId);
      setSentAt(Date.now());
    } catch {
      setError("Something went wrong. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  if (req && !timedOut && !dismissed && (req.status === "waiting_puck" || req.status === "proposed")) {
    return (
      <div className="mx-auto max-w-2xl py-6 text-center">
        <p className="text-[14px] font-[800] tracking-wide text-ink-soft uppercase">Check your puck</p>
        <p className="mt-4 text-[52px] leading-none font-[900] tracking-[-2px] tabular-nums md:text-[68px]">{amount(req.amount, req.token)}</p>
        <p className="mt-1 text-[22px] font-[800] text-ink-soft">{money(req.amount, req.token).split(" ").pop()}</p>
        <p className="mt-4 text-[17px]">
          to <strong>{payee?.label ?? "a new recipient"}</strong>
        </p>
        <p className="mt-2">
          <AddressText address={req.to} />
        </p>
        <Tinted className="mt-8 text-left text-[17px]">
          <p className="font-[800]">Waiting for you to approve on your puck.</p>
          <p className="mt-1">Check that its screen shows the same name, amount and address. If it differs from this page, press No.</p>
        </Tinted>
        <button
          type="button"
          className="mt-6 min-h-11 font-[700] underline underline-offset-4 hover:text-door"
          onClick={() => {
            source.sim?.puckReject(req.reqId);
            setDismissed(true);
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  const ended = req && !dismissed && (req.status === "rejected" || req.status === "failed" || timedOut);
  const lim = limitBig(symbol === "USDC" ? state.limits.usdc : state.limits.hbar);
  const after = raw && raw > 0n ? balance - raw : null;
  const bigToNew = !payee && raw !== null && raw > 0n && raw * 2n > balance;
  const blocked = frozen || tooMany;

  let panel: { tint: "soft" | "wait" | "stop"; title: string; text: string; extra?: string };
  if (frozen) panel = { tint: "stop", title: "Blocked", text: "Your account is frozen. Nothing can leave until the freeze ends." };
  else if (tooMany) panel = { tint: "stop", title: "Blocked", text: "Too many payments are waiting already. Wait for one to finish, or stop one." };
  else if (preview === null) panel = { tint: "soft", title: "Which rule applies", text: "Choose who and how much to see what will happen." };
  else if (preview === Tier.INSTANT) panel = { tint: "soft", title: "Right away", text: "This payment is sent right away." };
  else if (preview === Tier.WAIT)
    panel = {
      tint: "wait",
      title: `Waits ${duration(state.coolOff)}`,
      text: `This payment will wait ${duration(state.coolOff)}.${payee ? "" : " You have not paid this address before."} ${guardian} will be alerted and can stop it. You will be asked to confirm it once more.`,
    };
  else
    panel = {
      tint: "stop",
      title: "Needs approval",
      text: `This payment needs ${guardian}'s approval. Nothing leaves until they say yes.`,
      extra: bigToNew ? "Hisn never asks you to move money to keep it safe." : undefined,
    };

  const rules: Array<{ t: Tier; label: string; sub: string }> = [
    { t: Tier.INSTANT, label: "Right away", sub: `Saved names, up to ${money(lim.instantMax, tokenAddr, 0)}` },
    { t: Tier.WAIT, label: `After ${duration(state.coolOff)}`, sub: `New recipients, or up to ${money(lim.waitMax, tokenAddr, 0)}` },
    { t: Tier.APPROVAL, label: `Only if ${guardian} approves`, sub: "Anything larger" },
  ];

  return (
    <div>
      <PageTitle title="Send money" />
      {ended && (
        <Tinted tint={req?.status === "failed" ? "stop" : "soft"} className="mb-6">
          <span role="alert">
            {timedOut
              ? "Your puck did not answer in 2 minutes. Nothing was sent."
              : req?.status === "rejected"
                ? "You said No on your puck. Nothing was sent."
                : "Something went wrong. Nothing was sent."}
          </span>
        </Tinted>
      )}
      <form onSubmit={submit} className="grid gap-12 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <fieldset>
            <legend className="mb-3 text-[22px] font-[800]">Who to?</legend>
            <div className="flex flex-wrap gap-2">
              {state.payees.map((p) => {
                const on = who.kind === "saved" && who.address === p.address;
                const name = p.label ?? short(p.address);
                return (
                  <button
                    key={p.address}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setWho({ kind: "saved", address: p.address });
                      setNewAddress("");
                    }}
                    className={`inline-flex min-h-[54px] items-center gap-2.5 rounded-full border-2 py-1.5 pr-5 pl-1.5 font-[700] ${on ? "border-ink bg-ink text-paper" : "border-border bg-paper hover:border-ink"}`}
                  >
                    <Avatar name={name} size={40} />
                    {name}
                  </button>
                );
              })}
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[14px] font-[700] text-ink-soft">Or paste a new address</span>
              <span className="relative block">
                <input
                  value={newAddress}
                  onChange={(e) => {
                    setNewAddress(e.target.value);
                    if (e.target.value.trim()) setWho({ kind: "new" });
                    else if (state.payees[0]) setWho({ kind: "saved", address: state.payees[0].address });
                  }}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-[60px] w-full rounded-input border-2 border-border bg-paper px-4 pr-40 font-mono text-[16px] font-[600] focus:border-ink focus:outline-none"
                />
                {who.kind === "new" && validTo && !payee && (
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-hold-wash px-3 py-1 text-[13px] font-[800] text-hold">New recipient</span>
                )}
              </span>
            </label>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-[22px] font-[800]">How much?</legend>
            <div className="flex h-[84px] items-center rounded-[20px] border-2 border-ink bg-paper pr-2">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount"
                className="h-full min-w-0 flex-1 rounded-[20px] bg-transparent px-5 text-[44px] font-[900] tabular-nums focus:outline-none"
              />
              <div className="inline-flex gap-1 rounded-full bg-soft p-1" role="radiogroup" aria-label="Currency">
                {(["USDC", "HBAR"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={symbol === s}
                    onClick={() => setSymbol(s)}
                    className={`min-h-11 rounded-full px-4 font-[800] ${symbol === s ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-ink-soft">
              You have {money(spendable > 0n ? spendable : 0n, tokenAddr)}.{after !== null && after >= 0n && ` After this payment: ${amount(after, tokenAddr)}.`}
            </p>
          </fieldset>

          <Tinted tint={panel.tint} className="p-6">
            <p className="text-[14px] font-[800] uppercase">{panel.title}</p>
            <p className="mt-1 text-[17px]">{panel.text}</p>
            {panel.extra && <p className="mt-2 font-[800]">{panel.extra}</p>}
            {preview !== null && !blocked && (
              <p className="mt-2 text-[14px] opacity-80">{fromVault ? "Checked with your account just now." : "A preview. Your account makes the final decision."}</p>
            )}
          </Tinted>

          {error && (
            <p className="flex gap-2 rounded-panel bg-stop-wash px-4 py-3 font-[700] text-stop-text" role="alert">
              <Icon name="warn" size={18} className="mt-0.5" /> {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" className="max-md:h-[62px] max-md:w-full" disabled={busy || blocked}>
              {busy ? "Sending to your puck…" : "Continue on your puck"}
            </Button>
            <ButtonLink to="/" look="quiet" size="lg" className="max-md:w-full">
              Cancel
            </ButtonLink>
          </div>
        </div>

        <aside className="space-y-5">
          <Card title="Before you confirm">
            <dl>
              <Fact label="To">{payee?.label ?? (validTo ? short(to) : "Not chosen")}</Fact>
              <Fact label="Amount">{raw && raw > 0n ? money(raw, tokenAddr) : "-"}</Fact>
              <Fact label="Network fee">Paid in HBAR</Fact>
              <Fact label="Leaves">{preview === null ? "-" : preview === Tier.INSTANT ? "Right away" : preview === Tier.WAIT ? `In ${duration(state.coolOff)}` : "When approved"}</Fact>
              <Fact label="Guardian">{guardian}</Fact>
            </dl>
          </Card>
          <Card title="Which rule applies">
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.t} className={`rounded-input px-4 py-3 ${preview === r.t ? "bg-ink text-paper" : ""}`}>
                  <span className="block font-[800]">{r.label}</span>
                  <span className={`block text-[14px] ${preview === r.t ? "opacity-85" : "text-ink-soft"}`}>{r.sub}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Tinted>Check the address on your puck. Its screen shows what you are really signing. If it differs from this page, press No.</Tinted>
          <p className="px-1 text-[14px] text-ink-soft">
            <Link to="/payments" className="underline underline-offset-4">
              See your payments
            </Link>
          </p>
        </aside>
      </form>
    </div>
  );
}
