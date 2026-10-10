import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { PaymentView, StateView } from "../core/shared";
import { ago, amount, money, short, timeOfDay, token } from "../core/lib/format";
import { useNames } from "../core/lib/people";
import { phaseOf, type Phase } from "../core/lib/phase";
import { useSession, useSnapshot } from "../state/session";
import { Avatar, Button, Progress, T } from "./kit";
import { C, TONE_FG } from "./theme";

/** Header on every screen: who is using the phone, demo or live, and a way to switch account. */
export function AccountBar() {
  const { account, source } = useSession();
  const { connection, state } = useSnapshot();
  const live = source.kind === "live";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
        <Logo />
        <T size={24} weight="black" style={{ letterSpacing: -0.5 }}>
          hisn
        </T>
      </View>
      <View style={{ borderWidth: 1.5, borderColor: live ? (connection === "live" ? C.online : C.waitFg) : C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
        <T size={12} weight="heavy" color={C.muted}>
          {!live ? "Demo" : connection !== "live" ? "Reconnecting" : state.vaultId ? "Testnet" : "Local chain"}
        </T>
      </View>
      <Pressable accessibilityLabel="Settings" onPress={() => router.push("/settings")} hitSlop={10}>
        <Ionicons name="settings-outline" size={24} color={C.ink} />
      </Pressable>
      <Pressable accessibilityLabel="Switch account" onPress={() => router.replace("/")} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Avatar name={account?.name ?? "?"} size={38} tone="dark" />
        <Ionicons name="swap-horizontal" size={18} color={C.muted} />
      </Pressable>
    </View>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  const u = size / 100;
  const bar = (left: number, top: number, w: number, h: number, color: string, r = 6) => (
    <View style={{ position: "absolute", left: left * u, top: top * u, width: w * u, height: h * u, backgroundColor: color, borderRadius: r * u }} />
  );
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      {bar(16, 12, 22, 76, C.ink)}
      {bar(36, 40, 28, 18, C.ink, 0)}
      {bar(62, 12, 22, 52, C.ink)}
      {bar(62, 74, 22, 14, C.accent, 5)}
    </View>
  );
}

export function PaymentRow({ p, state, now, onPress }: { p: PaymentView; state: StateView; now: number; onPress?: () => void }) {
  const { nameOf } = useNames();
  const ph = phaseOf(p, state, now);
  const n = nameOf(p.to, state);
  const name = p.label ?? (n.includes("…") ? "New recipient" : n);
  const detail =
    ph.key === "releasing" ? `Leaves at ${timeOfDay(p.releaseAt)}` : ph.key === "cooling" || ph.key === "confirm_now" ? "Waits for a second yes" : ph.key === "needs_guardian" ? "Needs approval" : ago(p.proposedAt, now);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress ?? (() => router.push(`/payment/${p.id}`))}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line, opacity: pressed ? 0.7 : 1 })}
    >
      <Avatar name={name} tone={ph.tone === "hold" ? "hold" : ph.tone === "stop" ? "stop" : "quiet"} />
      <View style={{ flex: 1 }}>
        <T size={17} weight="bold" lines={1}>
          {name}
        </T>
        <T size={14} color={C.muted} lines={1}>
          {short(p.to)} · {detail}
        </T>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <T size={16} weight="heavy">
          {amount(p.amount, p.token)} {token(p.token).symbol}
        </T>
        <T size={14} weight="semibold" color={TONE_FG[ph.tone]}>
          {ph.word}
        </T>
      </View>
    </Pressable>
  );
}

/** Stop asks once more in place ("Yes, stop it" for 5 seconds), then acts. */
export function StopButton({ onStop, label = "Stop payment", doneText }: { onStop: () => Promise<void>; label?: string; doneText: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  if (done) {
    return (
      <T weight="bold" color={C.stopText}>
        {done}
      </T>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Button
        look="stop"
        icon="hand-left-outline"
        big
        busy={busy}
        onPress={async () => {
          if (!armed) return setArmed(true);
          setArmed(false);
          setBusy(true);
          setError(null);
          try {
            await onStop();
            setDone(doneText);
          } catch (e) {
            setError((e as Error).message || "Something went wrong. Nothing was sent.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {armed ? "Yes, stop it" : label}
      </Button>
      {error ? (
        <T size={14} weight="bold" color={C.stopFg}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function WaitingBanner({ p, ph, now, more, name, guardian, onStop }: { p: PaymentView; ph: Phase; now: number; more: number; name: string; guardian: string; onStop?: () => Promise<void> }) {
  const confirm = ph.key === "confirm_now";
  const approval = ph.key === "needs_guardian";
  const unconfirmed = confirm || ph.key === "cooling";
  const end = approval || unconfirmed ? p.expiresAt : p.releaseAt || ph.until || now;
  const value = end > p.proposedAt ? (now - p.proposedAt) / (end - p.proposedAt) : 1;
  const title = confirm ? "Confirm on your puck to let it leave" : approval ? `${money(p.amount, p.token)} needs ${guardian}'s approval` : `${money(p.amount, p.token)} to ${name} is waiting`;
  return (
    <View style={{ backgroundColor: C.waitBg, borderRadius: 28, padding: 20, gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="time-outline" size={26} color={C.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <T size={12} weight="heavy" color={C.waitFg} style={{ letterSpacing: 0.5 }}>
            {ph.word.toUpperCase()}
          </T>
          <T size={20} weight="heavy" color={C.waitText}>
            {title}
          </T>
          <T size={14} color={C.waitText} style={{ marginTop: 2 }}>
            {approval ? "Nothing leaves until your guardian says yes" : unconfirmed ? `Leaves only after your second yes, by ${timeOfDay(end)}` : `Leaves at ${timeOfDay(end)}`} · {guardian} was alerted{more > 0 ? ` · and ${more} more` : ""}
          </T>
        </View>
      </View>
      <Progress value={value} onWait from={`Signed ${timeOfDay(p.proposedAt)}`} to={approval || unconfirmed ? `Ends ${timeOfDay(end)}` : `Leaves ${timeOfDay(end)}`} />
      {onStop ? <StopButton onStop={onStop} doneText="Check your puck and enter your PIN to stop it. The money stays in your account." /> : null}
      <Button look="outline" onPress={() => router.push(`/payment/${p.id}`)}>
        Details
      </Button>
      <T size={14} color={C.waitText}>
        Stopping is always safe. The money stays in your account.
      </T>
    </View>
  );
}
