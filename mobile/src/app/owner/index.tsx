import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { HBAR } from "../../core/shared";
import { amount, dateTime, money } from "../../core/lib/format";
import { useNames } from "../../core/lib/people";
import { accountStatus, phaseOf } from "../../core/lib/phase";
import { useSession, useSnapshot, useUsdc } from "../../state/session";
import { Address, Avatar, Button, Empty, Screen, Section, T, Tinted } from "../../ui/kit";
import { AccountBar, PaymentRow, WaitingBanner } from "../../ui/parts";
import { QuantumLine } from "../../ui/quantum";
import { C } from "../../ui/theme";

export default function Home() {
  const { source } = useSession();
  const snap = useSnapshot();
  const usdc = useUsdc();
  const { state, payments, now, requests } = snap;
  const { nameOf } = useNames();
  const status = accountStatus(state, payments, now);
  const open = payments.filter((p) => phaseOf(p, state, now).live).length;
  const guardian = (state.guardians[0] ? nameOf(state.guardians[0], state) : "Your guardian").split(",")[0];
  const onPuck = requests.filter((r) => r.status === "waiting_puck");
  const [deposit, setDeposit] = useState(false);
  const [freezeNote, setFreezeNote] = useState<string | null>(null);

  return (
    <Screen header={<AccountBar />}>
      <T size={16} weight="semibold" color={C.muted}>
        Total protected
      </T>
      <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <T size={50} weight="black" style={{ letterSpacing: -2, lineHeight: 58 }}>
          {amount(state.balances.usdc, usdc)}
        </T>
        <T size={24} weight="black" color={C.muted}>
          USDC
        </T>
      </View>
      <T color={C.muted}>
        plus <T weight="bold">{money(state.balances.hbar, HBAR)}</T>
      </T>

      <View style={{ gap: 10, marginTop: 20 }}>
        <Button big icon="paper-plane-outline" onPress={() => router.push("/owner/send")}>
          Send
        </Button>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button look="quiet" icon="download-outline" style={{ flex: 1 }} onPress={() => setDeposit((v) => !v)}>
            Add money
          </Button>
          <Button
            look="quiet"
            icon="snow-outline"
            style={{ flex: 1 }}
            onPress={() => {
              setFreezeNote("Check your puck and enter your PIN to freeze. Nothing can leave while the account is frozen.");
              source.requestFreeze().catch(() => setFreezeNote("Your puck is not connected. Hold Freeze on your puck."));
            }}
          >
            Freeze
          </Button>
        </View>
      </View>

      {deposit ? (
        <Tinted style={{ marginTop: 14 }}>
          <T weight="bold">Send USDC or HBAR on Hedera testnet to your account:</T>
          <View style={{ marginTop: 8 }}>
            <Address value={state.vault} />
          </View>
        </Tinted>
      ) : null}
      {freezeNote && status.mood !== "frozen" ? (
        <Tinted tint="stop" style={{ marginTop: 14 }}>
          <T color={C.stopText}>{freezeNote}</T>
        </Tinted>
      ) : null}

      {onPuck.length > 0 ? (
        <Tinted style={{ marginTop: 18 }}>
          <T weight="heavy">Check your puck</T>
          <T style={{ marginTop: 4 }}>
            {onPuck.map((r) => `${money(r.amount, r.token)} to ${nameOf(r.to, state)}`).join(", ")} is waiting for your yes. Read the puck&apos;s screen, not this one.
          </T>
        </Tinted>
      ) : null}

      <View style={{ marginTop: 20 }}>
        {status.mood === "frozen" ? (
          <Tinted tint="stop">
            <T size={20} weight="heavy" color={C.stopText}>
              Your account is frozen until {dateTime(state.frozenUntil)}.
            </T>
            <T color={C.stopText} style={{ marginTop: 4 }}>
              Nothing can leave. The freeze ends by itself unless a different person renews it.
            </T>
          </Tinted>
        ) : status.focus && status.phase ? (
          <WaitingBanner
            p={status.focus}
            ph={status.phase}
            now={now}
            more={open - 1}
            name={status.focus.label ?? "a new recipient"}
            guardian={guardian}
            onStop={() => source.requestStop(status.focus!.id)}
          />
        ) : null}
      </View>

      <Section
        title="Recent payments"
        right={
          <Pressable onPress={() => router.push("/owner/payments")} hitSlop={8}>
            <T weight="bold">See all</T>
          </Pressable>
        }
      >
        {payments.length === 0 ? <Empty title="Nothing here yet.">Send your first payment.</Empty> : payments.slice(0, 5).map((p) => <PaymentRow key={p.id} p={p} state={state} now={now} />)}
      </Section>

      <Tinted style={{ marginTop: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={guardian} size={48} tone="dark" />
          <T size={17} weight="heavy" style={{ flex: 1 }}>
            {guardian} is your guardian.
          </T>
        </View>
        <T style={{ marginTop: 8 }}>
          {guardian} can stop a payment. {guardian} can never move your money.
        </T>
      </Tinted>
      <View style={{ marginTop: 14 }}>
        <QuantumLine />
      </View>
    </Screen>
  );
}
