import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useSnapshot } from "../state/session";
import { Card, Progress, T, Tinted } from "./kit";
import { C } from "./theme";

/** Quantum-safe status, only from what the vault reports (state.pq). */
export function QuantumLine() {
  const { state } = useSnapshot();
  const pq = state.pq;
  const on = !!pq?.root;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name="key-outline" size={16} color={on ? C.okFg : C.waitFg} />
      <T size={14} weight="bold" color={on ? C.okFg : C.waitFg}>
        {on && pq ? `Quantum-safe signatures on · ${pq.capacity - pq.used} of ${pq.capacity} left` : "Quantum-safe signatures off"}
      </T>
    </View>
  );
}

export function QuantumCard() {
  const { state } = useSnapshot();
  const pq = state.pq;
  if (!pq || !pq.root) {
    return (
      <Tinted tint="wait">
        <T weight="heavy" color={C.waitText}>
          Quantum-safe signatures are off
        </T>
        <T size={15} color={C.waitText} style={{ marginTop: 4 }}>
          This account checks the puck with ECDSA only. A large quantum computer could forge that. Deploy with the puck&apos;s hash-based key to turn it on.
        </T>
      </Tinted>
    );
  }
  const left = pq.capacity - pq.used;
  return (
    <Card title="Quantum-safe signatures">
      <T size={15}>
        Every payment, second confirmation and settings change needs two signatures from your puck: the usual one, and a hash-based one that a quantum computer cannot forge. Your account checks both on the Hedera network.
      </T>
      <View style={{ marginTop: 14 }}>
        <Progress value={pq.used / pq.capacity} from={`${pq.used} used`} to={`${left} one-time keys left`} />
      </View>
      <T size={14} color={C.muted} style={{ marginTop: 10 }}>
        Each key signs once. When they run low, the puck installs fresh keys through a settings change that your guardian approves.
      </T>
    </Card>
  );
}
