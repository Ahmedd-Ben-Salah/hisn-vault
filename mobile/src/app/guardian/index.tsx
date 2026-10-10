import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { PaymentView } from "../../core/shared";
import { dateTime, money, short, timeOfDay } from "../../core/lib/format";
import { phaseOf } from "../../core/lib/phase";
import { OWNER } from "../../state/accounts";
import { useSession, useSnapshot } from "../../state/session";
import { Avatar, Button, Empty, Progress, Screen, T, Tinted } from "../../ui/kit";
import { AccountBar, StopButton } from "../../ui/parts";
import { C } from "../../ui/theme";

/** Fact sentences for the alert. Computed from the vault's own data, so nothing here can be typed in by a stranger. */
function facts(p: PaymentView, all: PaymentView[]): string[] {
  const out: string[] = [];
  const paidBefore = all.some((x) => x.id !== p.id && x.status === "EXECUTED" && x.to.toLowerCase() === p.to.toLowerCase());
  if (!paidBefore) out.push(`${OWNER.name} has never paid this address.`);
  const past = all.filter((x) => x.id !== p.id && x.status === "EXECUTED" && x.token.toLowerCase() === p.token.toLowerCase()).map((x) => BigInt(x.amount));
  if (past.length) {
    past.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const median = past[past.length >> 1];
    if (median > 0n && BigInt(p.amount) >= median * 2n) out.push(`It is ${Number((BigInt(p.amount) * 10n) / median) / 10} times what ${OWNER.name} usually sends.`);
  }
  out.push(`${OWNER.name} approved it on her own puck.`);
  return out;
}

function Alert({ p }: { p: PaymentView }) {
  const { guardian } = useSession();
  const { state, now, payments } = useSnapshot();
  const ph = phaseOf(p, state, now);
  const approval = p.tier === "APPROVAL" && !p.confirmed;
  const [spoke, setSpoke] = useState(false);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const unconfirmed = p.tier === "WAIT" && !p.confirmed;
  const end = approval || unconfirmed ? p.expiresAt : p.releaseAt;
  const value = end > p.proposedAt ? (now - p.proposedAt) / (end - p.proposedAt) : 1;

  return (
    <View style={{ gap: 14, marginBottom: 26 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={OWNER.name} size={54} tone="dark" />
        <T size={20} weight="heavy" style={{ flex: 1 }}>
          {OWNER.name} is sending money. Please check.
        </T>
      </View>

      <View style={{ backgroundColor: C.waitBg, borderRadius: 28, padding: 20, gap: 8 }}>
        <T size={13} weight="heavy" color={C.waitFg} style={{ letterSpacing: 0.5 }}>
          {approval ? "NEEDS YOUR APPROVAL" : "WAITING"}
        </T>
        <T size={40} weight="black" color={C.waitText} style={{ letterSpacing: -1, lineHeight: 46 }}>
          {money(p.amount, p.token)}
        </T>
        <T size={17} weight="bold" color={C.waitText}>
          {p.label ? `to ${p.label}` : "to a new recipient"} · {short(p.to)}
        </T>
        <T color={C.waitText}>{approval
            ? "Nothing leaves until you approve."
            : unconfirmed
              ? `It leaves only if ${OWNER.name} confirms it again on her puck. If she does not by ${timeOfDay(end)}, nothing is sent.`
              : `Leaves at ${timeOfDay(end)} unless you stop it.`}</T>
        <Progress value={value} onWait from={`Signed ${timeOfDay(p.proposedAt)}`} to={approval || unconfirmed ? `Ends ${timeOfDay(end)}` : `Leaves ${timeOfDay(end)}`} />
      </View>

      <View style={{ gap: 8 }}>
        {facts(p, payments).map((f) => (
          <View key={f} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink, marginTop: 7 }} />
            <T style={{ flex: 1 }}>{f}</T>
          </View>
        ))}
      </View>

      <Tinted>
        <T weight="heavy">Call her on her usual number. Hisn never calls you.</T>
        <T style={{ marginTop: 4 }}>Ask: Who asked you to pay? Did anyone tell you to keep it secret? Have you met this person?</T>
      </Tinted>

      <StopButton onStop={() => guardian.stop(p.id)} doneText="Stopped. Stopping is a pause, not an accusation. Nobody can recover money for a fee." />

      {approval ? (
        <View style={{ gap: 10 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: spoke }}
            onPress={() => setSpoke((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderColor: C.border, borderRadius: 16, padding: 14 }}
          >
            <Ionicons name={spoke ? "checkbox" : "square-outline"} size={26} color={C.ink} />
            <T style={{ flex: 1 }}>I spoke to {OWNER.name} on her usual number.</T>
          </Pressable>
          <Button
            look="outline"
            disabled={!spoke}
            busy={approving}
            onPress={async () => {
              setApproving(true);
              setNote(null);
              try {
                await guardian.approve(p.id);
                setNote("Approved. It leaves after the waiting time. You can still stop it until then.");
              } catch (e) {
                setNote((e as Error).message);
              } finally {
                setApproving(false);
              }
            }}
          >
            Approve
          </Button>
        </View>
      ) : (
        <T size={14} color={C.muted}>
          Only {OWNER.name}&apos;s second yes on her puck releases it. You can stop it.
        </T>
      )}
      {note ? <T weight="bold">{note}</T> : null}
      <Pressable onPress={() => router.push(`/payment/${p.id}`)} style={{ minHeight: 44, justifyContent: "center" }}>
        <T weight="bold" style={{ textDecorationLine: "underline" }}>
          See all details
        </T>
      </Pressable>
      {ph.key === "confirm_now" ? (
        <T size={14} color={C.muted}>
          {OWNER.name} is being asked to confirm it once more now.
        </T>
      ) : null}
    </View>
  );
}

export default function Alerts() {
  const { guardian, source, account, guardianKey } = useSession();
  const { payments, state, now, connection } = useSnapshot();
  const [freezeArmed, setFreezeArmed] = useState(false);
  const [freezeNote, setFreezeNote] = useState<string | null>(null);
  const open = payments.filter((p) => phaseOf(p, state, now).live).sort((a, b) => a.releaseAt - b.releaseAt);
  const frozen = state.frozenUntil > now;
  const needsKey = source.kind === "live" && !guardianKey.address;

  return (
    <Screen header={<AccountBar />}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <View style={{ backgroundColor: C.soft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
          <T size={13} weight="heavy">
            Guardian
          </T>
        </View>
        <T color={C.muted}>{account?.name} · looking after {OWNER.name}</T>
      </View>

      {needsKey ? (
        <Tinted tint="wait" style={{ marginBottom: 16 }}>
          <T weight="heavy" color={C.waitText}>
            Add your guardian key
          </T>
          <T color={C.waitText} style={{ marginTop: 4 }}>
            In live mode, stopping signs with a key kept on this phone. Open Settings to create or import it.
          </T>
          <Button look="dark" style={{ marginTop: 10 }} onPress={() => router.push("/settings")}>
            Open Settings
          </Button>
        </Tinted>
      ) : null}

      {source.kind === "live" && connection === "offline" ? (
        <Tinted tint="wait" style={{ marginBottom: 16 }}>
          <T color={C.waitText}>Cannot reach the network right now. Still trying.</T>
        </Tinted>
      ) : null}

      {frozen ? (
        <Tinted tint="stop" style={{ marginBottom: 16 }}>
          <T size={18} weight="heavy" color={C.stopText}>
            {OWNER.name}&apos;s account is frozen
          </T>
          <T color={C.stopText} style={{ marginTop: 4 }}>
            Until {dateTime(state.frozenUntil)}. Nothing can leave.
          </T>
        </Tinted>
      ) : null}

      {open.length === 0 ? (
        <Empty title="All quiet.">You will be alerted here when {OWNER.name} sends money that waits.</Empty>
      ) : (
        open.map((p) => <Alert key={p.id} p={p} />)
      )}

      {!frozen ? (
        <View style={{ marginTop: 10, gap: 8 }}>
          <Button
            look="stopOutline"
            icon="snow-outline"
            onPress={async () => {
              if (!freezeArmed) return setFreezeArmed(true);
              setFreezeArmed(false);
              try {
                await guardian.freeze();
                setFreezeNote(`Frozen. Every waiting payment is stopped and nothing can leave ${OWNER.name}'s account for now.`);
              } catch (e) {
                setFreezeNote((e as Error).message);
              }
            }}
          >
            {freezeArmed ? "Yes, freeze everything" : `Freeze ${OWNER.name}'s whole account`}
          </Button>
          {freezeNote ? <T weight="bold">{freezeNote}</T> : null}
        </View>
      ) : null}
    </Screen>
  );
}
