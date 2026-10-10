import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { hashscanSchedule, hashscanTopic, hashscanTx, type PaymentView, type TimelineEntry } from "../../core/shared";
import { duration, money, timeOfDay } from "../../core/lib/format";
import { useNames } from "../../core/lib/people";
import { phaseOf, type Phase } from "../../core/lib/phase";
import { useSession, useSnapshot } from "../../state/session";
import { Address, Card, Chip, Empty, Progress, Row, Screen, T, Tinted } from "../../ui/kit";
import { AccountBar, StopButton } from "../../ui/parts";
import { C } from "../../ui/theme";

function explain(p: PaymentView, ph: Phase, guardian: string): string {
  switch (ph.key) {
    case "cooling":
      return `You will be asked to confirm again at ${timeOfDay(p.confirmFrom)}.`;
    case "confirm_now":
      return `Confirm once more on your puck to let it leave at ${timeOfDay(Math.max(p.releaseAt, p.confirmFrom))}.`;
    case "releasing":
      return `Leaves by itself at ${timeOfDay(p.releaseAt)}, unless you or ${guardian} stop it.`;
    case "due":
      return "Its time has come. The Hedera network should send it in a few seconds.";
    case "needs_guardian":
      return `Nothing leaves until ${guardian} approves.`;
    case "released":
      return p.executedBy === "agent" ? "Paid by the helper, inside its allowance." : p.tier === "INSTANT" ? "Sent right away." : "Sent by the Hedera network.";
    case "stopped":
      return "Stopped. The money never left the account.";
    case "cancelled":
      return "Cancelled. Nothing was sent.";
    case "frozen_out":
      return "The account was frozen while this waited. Nothing was sent.";
    case "expired":
      return "Not confirmed in time. Nothing was sent.";
  }
}

const STEP_NAMES: Record<string, string> = {
  REQUEST: "Asked",
  PAY_SIGNED: "Approved on the puck",
  Proposed: "Recorded by the account",
  PROPOSED: "Recorded by the account",
  ALERT_ACK: "Guardian alerted",
  RECONFIRM_SIGNED: "Confirmed again",
  Confirmed: "Confirmed",
  APPROVE_SIGNED: "Approved by the guardian",
  Executed: "Sent",
  RELEASED: "Sent by the network",
  Vetoed: "Stopped",
  VETO_SIGNED: "Stopped",
  Cancelled: "Cancelled",
  Expired: "Expired",
  AgentPaid: "Paid by the helper",
};

export default function PaymentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const { source, account, guardian } = useSession();
  const { payments, state, now, log } = useSnapshot();
  const { nameOf } = useNames();
  const p = payments.find((x) => x.id === pid);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    let alive = true;
    source
      .timeline(pid)
      .then((e) => alive && setEntries(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [source, pid, p?.status, p?.confirmed, log.length]);

  const back = (
    <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
      <Ionicons name="chevron-back" size={20} color={C.muted} />
      <T weight="bold" color={C.muted}>
        Back
      </T>
    </Pressable>
  );

  if (!p) {
    return (
      <Screen header={<AccountBar />}>
        {back}
        <Empty title="We could not find this payment." />
      </Screen>
    );
  }

  const ph = phaseOf(p, state, now);
  const guardianName = (state.guardians[0] ? nameOf(state.guardians[0], state) : "your guardian").split(",")[0];
  const isGuardian = account?.role === "guardian";
  const chipWord = ph.key === "cooling" || ph.key === "releasing" || ph.key === "due" ? "Waiting" : ph.word;
  const end = ph.key === "cooling" ? p.confirmFrom : p.releaseAt;
  const showProgress = ph.key === "cooling" || ph.key === "releasing";
  const off = source.kind === "mock" || !state.vaultId;
  // One line per step: the relayer note and the chain event can both report the same step.
  const seen = entries.filter((e) => STEP_NAMES[e.name]).filter((e, i, all) => i === 0 || STEP_NAMES[e.name] !== STEP_NAMES[all[i - 1].name]);

  return (
    <Screen header={<AccountBar />}>
      {back}
      <Chip tone={ph.tone} word={chipWord} />
      <T size={30} weight="black" style={{ letterSpacing: -1, lineHeight: 36, marginTop: 12 }}>
        {money(p.amount, p.token)} to {p.label ?? "a new recipient"}
      </T>
      <T size={17} style={{ marginTop: 8 }}>
        {explain(p, ph, guardianName)}
      </T>

      {ph.live ? (
        <View style={{ backgroundColor: C.waitBg, borderRadius: 28, padding: 20, gap: 14, marginTop: 18 }}>
          {ph.key === "confirm_now" && !isGuardian ? (
            <T color={C.waitText}>
              <T weight="heavy" color={C.waitText}>
                Check your puck.
              </T>{" "}
              It asks: &quot;Has anyone told you to keep this secret or told you what to say?&quot; Say yes only if no one has.
            </T>
          ) : null}
          {showProgress ? <Progress value={end > p.proposedAt ? (now - p.proposedAt) / (end - p.proposedAt) : 1} onWait from={`Signed ${timeOfDay(p.proposedAt)}`} to={ph.key === "cooling" ? `Confirm at ${timeOfDay(end)}` : `Leaves ${timeOfDay(end)}`} /> : null}
          {isGuardian ? (
            <StopButton onStop={() => guardian.stop(p.id)} doneText="Stopped. Stopping is a pause, not an accusation. Nobody can recover money for a fee." />
          ) : (
            <StopButton onStop={() => source.requestStop(p.id)} doneText="Check your puck and enter your PIN to stop it. The money stays in your account." />
          )}
          <T size={14} color={C.waitText}>
            Stopping is always safe. The money stays in the account.
          </T>
        </View>
      ) : null}

      {ph.key === "stopped" ? (
        <Tinted tint="stop" style={{ marginTop: 18 }}>
          <T size={18} weight="heavy" color={C.stopText}>
            The money never left the account.
          </T>
          <T color={C.stopText} style={{ marginTop: 4 }}>
            Nobody can recover money for a fee.
          </T>
        </Tinted>
      ) : null}

      <T size={22} weight="heavy" style={{ marginTop: 26, marginBottom: 8 }}>
        What has happened
      </T>
      {seen.length === 0 ? (
        <T color={C.muted}>Loading the record…</T>
      ) : (
        seen.map((e, i) => (
          <View key={`${e.name}-${i}`} style={{ flexDirection: "row", gap: 12, paddingBottom: 14 }}>
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.ink, marginTop: 3 }} />
              {i < seen.length - 1 ? <View style={{ width: 3, flex: 1, backgroundColor: C.ink, marginTop: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <T size={16} weight="heavy" style={{ flex: 1 }}>
                {STEP_NAMES[e.name]}
              </T>
              <T size={14} weight="semibold" color={C.muted}>
                {timeOfDay(e.at)}
              </T>
            </View>
          </View>
        ))
      )}

      <Card title="Details" style={{ marginTop: 16 }}>
        <Row label="To">
          <Address value={p.to} />
        </Row>
        <Row label="Name">{p.label ?? "New recipient. No saved name."}</Row>
        <Row label="Amount">{money(p.amount, p.token)}</Row>
        <Row label="Rule">{p.tier === "INSTANT" ? "Right away" : p.tier === "WAIT" ? "Waits" : "Needs approval"}</Row>
        {p.tier !== "INSTANT" ? <Row label="Wait">{duration(p.releaseAt - p.proposedAt)}</Row> : null}
        <Row label="Guardian">{guardianName}</Row>
      </Card>

      <Card title="Proof" style={{ marginTop: 14 }}>
        {off ? (
          <T color={C.muted}>Demo data: there is nothing to open on HashScan.</T>
        ) : (
          <View style={{ gap: 4 }}>
            {[
              ["Transaction", p.txs.executed ?? p.txs.proposed ? hashscanTx((p.txs.executed ?? p.txs.proposed)!) : null],
              ["Network timer", p.schedule ? hashscanSchedule(p.schedule) : null],
              ["Public record", state.topicId ? hashscanTopic(state.topicId) : null],
            ]
              .filter(([, href]) => href)
              .map(([label, href]) => (
                <Pressable key={label} onPress={() => void Linking.openURL(href as string)} style={{ minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <T>{label}</T>
                  <T weight="bold" style={{ textDecorationLine: "underline" }}>
                    HashScan
                  </T>
                </Pressable>
              ))}
          </View>
        )}
      </Card>
      <Tinted style={{ marginTop: 14 }}>
        <T>Our server cannot move or block your money. Every step is recorded on the Hedera network.</T>
      </Tinted>
    </Screen>
  );
}
