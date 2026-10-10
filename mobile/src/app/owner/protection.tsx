import { View } from "react-native";
import { dateTime, duration, money } from "../../core/lib/format";
import { useNames } from "../../core/lib/people";
import { limitBig, ratio, windowsFor } from "../../core/lib/windows";
import { HBAR } from "../../core/shared";
import { useSession, useSnapshot, useUsdc } from "../../state/session";
import { Card, Progress, Row, Screen, T, Tinted, tintText, Title, type Tint } from "../../ui/kit";
import { AccountBar } from "../../ui/parts";
import { QuantumCard } from "../../ui/quantum";
import { C } from "../../ui/theme";

function RuleCard({ tint, label, title, text, used, max, token }: { tint: Tint; label: string; title: string; text: string; used: bigint; max: bigint; token: string }) {
  return (
    <Tinted tint={tint} style={{ gap: 6 }}>
      <T size={13} weight="heavy" color={tintText(tint)} style={{ letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </T>
      <T size={26} weight="black" color={tintText(tint)}>
        {title}
      </T>
      <T color={tintText(tint)}>{text}</T>
      <View style={{ marginTop: 6 }}>
        <Progress value={ratio(used, max)} onWait={tint === "wait"} from="Today and yesterday" to={`${money(used, token, 0)} of ${money(max, token, 0)}`} />
      </View>
    </Tinted>
  );
}

export default function Protection() {
  const { source } = useSession();
  const usdc = useUsdc();
  const { state, payments, now, log } = useSnapshot();
  const { nameOf } = useNames();
  const lim = limitBig(state.limits.usdc);
  const w = windowsFor(payments, usdc, now, source.kind === "live" ? log : []);
  const guardian = (state.guardians[0] ? nameOf(state.guardians[0], state) : "your guardian").split(",")[0];
  const im = state.immutables;
  const frozen = state.frozenUntil > now;

  return (
    <Screen header={<AccountBar />}>
      <Title sub="How your money leaves, and what slows it down. Our server cannot move or block your money.">Protection</Title>
      <View style={{ gap: 12 }}>
        <RuleCard tint="ok" label="Right away" title={`Up to ${money(lim.instantMax, usdc, 0)}`} text="Saved names only." used={w.instant} max={lim.dailyCap} token={usdc} />
        <RuleCard tint="wait" label={`After ${duration(state.coolOff)}`} title={`Up to ${money(lim.waitMax, usdc, 0)}`} text={`New recipients or bigger amounts. ${guardian} is alerted and you confirm once more.`} used={w.waiting} max={lim.waitMax} token={usdc} />
        <RuleCard tint="stop" label={`Only if ${guardian} approves`} title="Anything larger" text="More than half your balance to someone new, or over the waiting limit." used={0n} max={1n} token={usdc} />
      </View>

      <View style={{ marginTop: 16 }}>
        <QuantumCard />
      </View>

      <Card title="Freeze" style={{ marginTop: 16 }}>
        <T>
          {frozen
            ? `Frozen until ${dateTime(state.frozenUntil)}. Nothing can leave.`
            : `Your puck, a guardian or the alarm light can freeze everything for ${duration(im.freezeMax)}. It ends by itself unless a different person renews it.`}
        </T>
      </Card>

      <Card title="Locked for good" style={{ marginTop: 16 }}>
        <Row label="Shortest wait">{duration(im.minCoolOff)}</Row>
        <Row label="Wait before a rule change">{duration(im.settingsDelay)}</Row>
        <Row label="Wait before replacing a lost puck">{duration(im.recoveryDelay)}</Row>
        <Row label="Most payments waiting at once">{String(im.maxPending)}</Row>
        <T size={14} color={C.muted} style={{ marginTop: 8 }}>
          Written into the contract when it was created. No setting, admin key or upgrade can shorten them.
        </T>
      </Card>

      <Card title="Helper" style={{ marginTop: 16 }}>
        <T>
          The helper can pay saved names only, up to {money(lim.agentDailyMax, usdc, 0)} over today and yesterday. Used: {money(w.agent, usdc)}.
        </T>
      </Card>

      <Card title="Devices" style={{ marginTop: 16, marginBottom: 8 }}>
        {state.devices.length === 0 ? (
          <T color={C.muted}>No device reported yet.</T>
        ) : (
          state.devices.map((d) => (
            <Row key={d.id} label={d.role === "puck" ? "Puck" : d.role === "watcher" ? "Alarm light" : d.role === "page" ? "Guardian phone" : "Guardian"}>
              <T weight="bold" color={d.online ? C.okFg : C.muted}>
                {d.online ? "Online" : "Offline"}
              </T>
            </Row>
          ))
        )}
      </Card>
      <T size={13} color={C.muted}>
        HBAR limits follow the same rules. Network fees are paid in {money(state.gasReserve, HBAR, 0)} kept aside.
      </T>
    </Screen>
  );
}
