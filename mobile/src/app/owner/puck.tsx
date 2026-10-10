import { Switch, View } from "react-native";
import { money, short } from "../../core/lib/format";
import { useNames } from "../../core/lib/people";
import { phaseOf } from "../../core/lib/phase";
import { useSession, useSnapshot } from "../../state/session";
import { Button, Card, Empty, Screen, T, Tinted, Title } from "../../ui/kit";
import { AccountBar } from "../../ui/parts";
import { C } from "../../ui/theme";

/**
 * Stands in for Amel's ESP32 puck in the demo (or the laptop's device simulator in live mode).
 * The real puck has its own screen and signs with ECDSA plus a hash-based (quantum-safe) key.
 */
export default function Puck() {
  const { source } = useSession();
  const sim = source.sim;
  const { requests, payments, state, now, changeRequests } = useSnapshot();
  const { nameOf } = useNames();
  if (!sim) {
    return (
      <Screen header={<AccountBar />}>
        <Title>Puck</Title>
        <Empty title="Use your real puck.">The simulated puck is only available in demo mode.</Empty>
      </Screen>
    );
  }
  const toSign = requests.filter((r) => r.status === "waiting_puck");
  const toConfirm = payments.filter((p) => phaseOf(p, state, now).key === "confirm_now");
  const changes = changeRequests.filter((c) => c.status === "waiting_puck");
  const nothing = toSign.length + toConfirm.length + changes.length === 0;

  return (
    <Screen header={<AccountBar />}>
      <Title sub="This screen plays Amel's puck for the demo. The real puck is an ESP32 with its own screen and buttons.">Puck (simulated)</Title>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T weight="heavy">Sign by itself</T>
            <T size={14} color={C.muted}>
              New payments are signed after 3 seconds. Turn off to press Yes or No yourself.
            </T>
          </View>
          <Switch value={sim.autoPuck} onValueChange={(v) => sim.setAutoPuck(v)} trackColor={{ true: C.ink, false: C.border }} />
        </View>
      </Card>

      {nothing ? (
        <View style={{ marginTop: 18 }}>
          <Empty title="Nothing to sign.">Send money from the Send tab, or wait for a payment to ask for its second confirmation.</Empty>
        </View>
      ) : null}

      {toSign.map((r) => (
        <Tinted key={`r${r.reqId}`} style={{ marginTop: 16, gap: 10 }}>
          <T size={13} weight="heavy" color={C.muted}>
            NEW PAYMENT
          </T>
          <T size={26} weight="black">
            {money(r.amount, r.token)}
          </T>
          <T>
            to {nameOf(r.to, state)} · {short(r.to)}
          </T>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button look="outline" style={{ flex: 1 }} onPress={() => sim.puckReject(r.reqId)}>
              No
            </Button>
            <Button look="dark" style={{ flex: 1 }} onPress={() => sim.puckSign(r.reqId)}>
              Yes, sign
            </Button>
          </View>
        </Tinted>
      ))}

      {toConfirm.map((p) => (
        <Tinted key={`p${p.id}`} tint="wait" style={{ marginTop: 16, gap: 10 }}>
          <T size={13} weight="heavy" color={C.waitFg}>
            STILL SEND?
          </T>
          <T size={26} weight="black" color={C.waitText}>
            {money(p.amount, p.token)}
          </T>
          <T color={C.waitText}>Has anyone told you to keep this secret or told you what to say? Say yes only if no one has.</T>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button look="stop" style={{ flex: 1 }} onPress={() => sim.puckCancel(p.id)}>
              No, cancel
            </Button>
            <Button look="dark" style={{ flex: 1 }} onPress={() => sim.puckReconfirm(p.id)}>
              Confirm again
            </Button>
          </View>
        </Tinted>
      ))}

      {changes.map((c) => (
        <Tinted key={`c${c.reqId}`} style={{ marginTop: 16, gap: 10 }}>
          <T size={13} weight="heavy" color={C.muted}>
            SETTINGS CHANGE
          </T>
          <T weight="bold">{c.kind.replaceAll("_", " ").toLowerCase()}</T>
          <Button look="dark" onPress={() => sim.puckSignChange(c.reqId)}>
            Sign the change
          </Button>
        </Tinted>
      ))}
    </Screen>
  );
}
