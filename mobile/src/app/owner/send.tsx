import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { MOCK } from "../../core/data/mock";
import { HBAR, Tier, predictTier } from "../../core/shared";
import { amount, duration, money, short, toRaw } from "../../core/lib/format";
import { useNames } from "../../core/lib/people";
import { limitBig, windowsFor } from "../../core/lib/windows";
import { useSession, useSnapshot, useUsdc } from "../../state/session";
import { Address, Avatar, Button, Card, Row, Screen, T, Tinted, tintText, Title, type Tint } from "../../ui/kit";
import { AccountBar } from "../../ui/parts";
import { C, F } from "../../ui/theme";

type Who = { kind: "saved"; address: string } | { kind: "new" };
const PUCK_TIMEOUT_S = 120;

export default function Send() {
  const { source } = useSession();
  const usdc = useUsdc();
  const { nameOf } = useNames();
  const { state, payments, requests, now } = useSnapshot();
  const [picked, setWho] = useState<Who | null>(null);
  const who: Who = picked ?? (state.payees[0] ? { kind: "saved", address: state.payees[0].address } : { kind: "new" });
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
    return predictTier({
      amount: raw,
      isPayee: !!payee,
      pastProbation: !!payee && now - payee.since >= state.immutables.probation,
      vaultBalance: balance,
      instantSpent2d: windowsFor(payments, tokenAddr, now).instant,
      waitQueued2d: windowsFor(payments, tokenAddr, now).waiting,
      limits: limitBig(symbol === "USDC" ? state.limits.usdc : state.limits.hbar),
    });
  }, [raw, validTo, symbol, state, payments, tokenAddr, now, payee, balance]);

  // The level comes from the backend when it is live; the local guess only fills the gap.
  const [checked, setChecked] = useState<{ key: string; tier: Tier } | null>(null);
  const checkKey = raw && raw > 0n && validTo ? `${to.toLowerCase()}|${tokenAddr}|${raw.toString()}|${payments.length}` : "";
  useEffect(() => {
    if (!checkKey || !source.previewTier || source.kind !== "live") return;
    let alive = true;
    const t = setTimeout(() => {
      const [a, tk, amt] = checkKey.split("|");
      source.previewTier!(a, tk, amt).then((n) => alive && setChecked({ key: checkKey, tier: Tier[n] })).catch(() => undefined);
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
  const timedOut = req?.status === "waiting_puck" && sentAt > 0 && now - sentAt > PUCK_TIMEOUT_S;

  // Once the vault has the payment, open it. Navigate first, on the next tick, then clear the form.
  const proposedId = req?.status === "proposed" ? req.paymentId : undefined;
  useEffect(() => {
    if (proposedId === undefined) return;
    const t = setTimeout(() => {
      router.push({ pathname: "/payment/[id]", params: { id: String(proposedId) } });
      setReqId(null);
      setValue("");
    }, 0);
    return () => clearTimeout(t);
  }, [proposedId]);

  async function submit() {
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
      setSentAt(now);
    } catch (e) {
      setError(`${(e as Error).message || "Something went wrong"}. Nothing was sent.`);
    } finally {
      setBusy(false);
    }
  }

  if (req && !timedOut && !dismissed && req.status === "waiting_puck") {
    return (
      <Screen header={<AccountBar />}>
        <T size={13} weight="heavy" color={C.muted} style={{ textAlign: "center", letterSpacing: 0.5 }}>
          CHECK YOUR PUCK
        </T>
        <T size={56} weight="black" style={{ textAlign: "center", letterSpacing: -2, lineHeight: 64, marginTop: 10 }}>
          {amount(req.amount, req.token)}
        </T>
        <T size={22} weight="heavy" color={C.muted} style={{ textAlign: "center" }}>
          {money(req.amount, req.token).split(" ").pop()}
        </T>
        <T size={17} style={{ textAlign: "center", marginTop: 12 }}>
          to <T weight="bold">{payee?.label ?? "a new recipient"}</T>
        </T>
        <View style={{ alignItems: "center", marginTop: 6 }}>
          <Address value={req.to} />
        </View>
        <Tinted style={{ marginTop: 24 }}>
          <T weight="heavy">Waiting for you to approve on your puck.</T>
          <T style={{ marginTop: 4 }}>Check that its screen shows the same name, amount and address. If it differs from this page, press No.</T>
          {source.sim ? (
            <T size={14} color={C.muted} style={{ marginTop: 8 }}>
              Demo: the simulated puck signs by itself in a few seconds, or open the Puck tab.
            </T>
          ) : null}
        </Tinted>
        <Button
          look="quiet"
          style={{ marginTop: 18 }}
          onPress={() => {
            source.sim?.puckReject(req.reqId);
            setDismissed(true);
          }}
        >
          Cancel
        </Button>
      </Screen>
    );
  }

  const ended = req && !dismissed && (req.status === "rejected" || req.status === "failed" || timedOut);
  const lim = limitBig(symbol === "USDC" ? state.limits.usdc : state.limits.hbar);
  const after = raw && raw > 0n ? balance - raw : null;
  const bigToNew = !payee && raw !== null && raw > 0n && raw * 2n > balance;
  const blocked = frozen || tooMany;

  let panel: { tint: Tint; title: string; text: string; extra?: string };
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

  return (
    <Screen header={<AccountBar />}>
      <Title>Send money</Title>
      {ended ? (
        <Tinted tint={req?.status === "failed" ? "stop" : "soft"} style={{ marginBottom: 16 }}>
          <T>{timedOut ? "Your puck did not answer in 2 minutes. Nothing was sent." : req?.status === "rejected" ? "You said No on your puck. Nothing was sent." : "Something went wrong. Nothing was sent."}</T>
        </Tinted>
      ) : null}

      <T size={20} weight="heavy" style={{ marginBottom: 10 }}>
        Who to?
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {state.payees.map((p) => {
          const on = who.kind === "saved" && who.address === p.address;
          const name = p.label ?? short(p.address);
          return (
            <Pressable
              key={p.address}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setWho({ kind: "saved", address: p.address });
                setNewAddress("");
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 5, paddingRight: 16, minHeight: 50, borderRadius: 999, borderWidth: 2, borderColor: on ? C.ink : C.border, backgroundColor: on ? C.ink : C.bg }}
            >
              <Avatar name={name} size={38} />
              <T weight="bold" color={on ? C.bg : C.ink}>
                {name}
              </T>
            </Pressable>
          );
        })}
      </View>
      <T size={14} weight="bold" color={C.muted} style={{ marginTop: 14, marginBottom: 6 }}>
        Or paste a new address
      </T>
      <TextInput
        value={newAddress}
        onChangeText={(t) => {
          setNewAddress(t);
          if (t.trim()) setWho({ kind: "new" });
          else setWho(null);
        }}
        placeholder="0x…"
        placeholderTextColor={C.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ height: 56, borderRadius: 16, borderWidth: 2, borderColor: C.border, paddingHorizontal: 16, fontFamily: F.semibold, fontSize: 15, color: C.ink }}
      />
      {who.kind === "new" && validTo && !payee ? (
        <View style={{ alignSelf: "flex-start", marginTop: 8, backgroundColor: C.waitBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
          <T size={13} weight="heavy" color={C.waitFg}>
            New recipient
          </T>
        </View>
      ) : null}
      {source.kind === "mock" && who.kind === "saved" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setNewAddress(MOCK.strangers[1]);
            setWho({ kind: "new" });
          }}
          style={{ marginTop: 8, minHeight: 44, justifyContent: "center" }}
        >
          <T size={14} weight="bold" color={C.accent}>
            Demo: paste a stranger&apos;s address
          </T>
        </Pressable>
      ) : null}

      <T size={20} weight="heavy" style={{ marginTop: 22, marginBottom: 10 }}>
        How much?
      </T>
      <View style={{ flexDirection: "row", alignItems: "center", height: 80, borderRadius: 20, borderWidth: 2, borderColor: C.ink, paddingRight: 8 }}>
        <TextInput
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={C.border}
          accessibilityLabel="Amount"
          style={{ flex: 1, paddingHorizontal: 18, fontFamily: F.black, fontSize: 38, color: C.ink }}
        />
        <View style={{ flexDirection: "row", backgroundColor: C.soft, borderRadius: 999, padding: 4, gap: 4 }}>
          {(["USDC", "HBAR"] as const).map((sym) => (
            <Pressable key={sym} onPress={() => setSymbol(sym)} accessibilityRole="radio" accessibilityState={{ checked: symbol === sym }} style={{ paddingHorizontal: 12, height: 40, justifyContent: "center", borderRadius: 999, backgroundColor: symbol === sym ? C.ink : "transparent" }}>
              <T weight="heavy" color={symbol === sym ? C.bg : C.muted}>
                {sym}
              </T>
            </Pressable>
          ))}
        </View>
      </View>
      <T color={C.muted} style={{ marginTop: 8 }}>
        You have {money(spendable > 0n ? spendable : 0n, tokenAddr)}.{after !== null && after >= 0n ? ` After this payment: ${amount(after, tokenAddr)}.` : ""}
      </T>

      <Tinted tint={panel.tint} style={{ marginTop: 18 }}>
        <T size={13} weight="heavy" color={tintText(panel.tint)} style={{ letterSpacing: 0.5 }}>
          {panel.title.toUpperCase()}
        </T>
        <T size={16} color={tintText(panel.tint)} style={{ marginTop: 4 }}>
          {panel.text}
        </T>
        {panel.extra ? (
          <T weight="heavy" color={tintText(panel.tint)} style={{ marginTop: 6 }}>
            {panel.extra}
          </T>
        ) : null}
        {preview !== null && !blocked ? (
          <T size={13} color={tintText(panel.tint)} style={{ marginTop: 6, opacity: 0.8 }}>
            {fromVault ? "Checked with your account just now." : "A preview. Your account makes the final decision."}
          </T>
        ) : null}
      </Tinted>

      {error ? (
        <Tinted tint="stop" style={{ marginTop: 14 }}>
          <T weight="bold" color={C.stopText}>
            {error}
          </T>
        </Tinted>
      ) : null}

      <View style={{ gap: 10, marginTop: 18 }}>
        <Button big busy={busy} disabled={blocked} onPress={submit}>
          Continue on your puck
        </Button>
        <Button look="quiet" onPress={() => router.push("/owner")}>
          Cancel
        </Button>
      </View>

      <Card title="Before you confirm" style={{ marginTop: 24 }}>
        <Row label="To">{payee?.label ?? (validTo ? short(to) : "Not chosen")}</Row>
        <Row label="Amount">{raw && raw > 0n ? money(raw, tokenAddr) : "-"}</Row>
        <Row label="Leaves">{preview === null ? "-" : preview === Tier.INSTANT ? "Right away" : preview === Tier.WAIT ? `In ${duration(state.coolOff)}` : "When approved"}</Row>
        <Row label="Guardian">{guardian}</Row>
      </Card>
      <Card title="Which rule applies" style={{ marginTop: 14 }}>
        {[
          { t: Tier.INSTANT, label: "Right away", sub: `Saved names, up to ${money(lim.instantMax, tokenAddr, 0)}` },
          { t: Tier.WAIT, label: `After ${duration(state.coolOff)}`, sub: `New recipients, or up to ${money(lim.waitMax, tokenAddr, 0)}` },
          { t: Tier.APPROVAL, label: `Only if ${guardian} approves`, sub: "Anything larger" },
        ].map((r) => (
          <View key={r.t} style={{ borderRadius: 16, padding: 12, backgroundColor: preview === r.t ? C.ink : "transparent" }}>
            <T weight="heavy" color={preview === r.t ? C.bg : C.ink}>
              {r.label}
            </T>
            <T size={14} color={preview === r.t ? C.soft : C.muted}>
              {r.sub}
            </T>
          </View>
        ))}
      </Card>
      <Tinted style={{ marginTop: 14 }}>
        <T>Check the address on your puck. Its screen shows what you are really signing. If it differs from this page, press No.</T>
      </Tinted>
    </Screen>
  );
}
