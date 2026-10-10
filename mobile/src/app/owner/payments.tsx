import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useNames } from "../../core/lib/people";
import { phaseOf } from "../../core/lib/phase";
import { useSnapshot } from "../../state/session";
import { Empty, Screen, T, Title } from "../../ui/kit";
import { AccountBar, PaymentRow } from "../../ui/parts";
import { C, F } from "../../ui/theme";

type Filter = "all" | "open" | "paid" | "stopped";

function dayOf(at: number, now: number): string {
  const d = new Date(at * 1000).toDateString();
  if (d === new Date(now * 1000).toDateString()) return "Today";
  if (d === new Date((now - 86400) * 1000).toDateString()) return "Yesterday";
  return "Earlier";
}

export default function Payments() {
  const { payments, state, now } = useSnapshot();
  const { nameOf } = useNames();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const ph = new Map(payments.map((p) => [p.id, phaseOf(p, state, now)]));
  const stopped = (k: string) => ["stopped", "cancelled", "frozen_out"].includes(k);
  const waiting = payments.filter((p) => ph.get(p.id)!.live).length;
  const query = q.trim().toLowerCase();
  const shown = payments.filter((p) => {
    const k = ph.get(p.id)!;
    if (filter === "open" && !k.live) return false;
    if (filter === "paid" && k.key !== "released") return false;
    if (filter === "stopped" && !stopped(k.key)) return false;
    return !query || [p.label ?? "", nameOf(p.to, state), p.to].some((x) => x.toLowerCase().includes(query));
  });
  const groups = (["Today", "Yesterday", "Earlier"] as const).map((g) => ({ g, items: shown.filter((p) => dayOf(p.proposedAt, now) === g) })).filter((x) => x.items.length);
  const filters: [Filter, string][] = [
    ["all", "All"],
    ["open", `Waiting · ${waiting}`],
    ["paid", "Paid"],
    ["stopped", "Stopped"],
  ];

  return (
    <Screen header={<AccountBar />}>
      <Title>Payments</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {filters.map(([k, label]) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === k }}
            onPress={() => setFilter(k)}
            style={{ height: 42, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", backgroundColor: filter === k ? C.ink : C.bg, borderWidth: filter === k ? 0 : 1.5, borderColor: C.border }}
          >
            <T weight="heavy" color={filter === k ? C.bg : C.muted}>
              {label}
            </T>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search a name or address"
        placeholderTextColor={C.muted}
        style={{ marginTop: 12, height: 48, borderRadius: 999, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 18, fontFamily: F.medium, fontSize: 16, color: C.ink }}
      />
      {groups.length === 0 ? (
        <View style={{ marginTop: 20 }}>
          <Empty title="Nothing here yet." />
        </View>
      ) : (
        groups.map(({ g, items }) => (
          <View key={g} style={{ marginTop: 22 }}>
            <T size={13} weight="heavy" color={C.muted} style={{ letterSpacing: 0.5 }}>
              {g.toUpperCase()}
            </T>
            {items.map((p) => (
              <PaymentRow key={p.id} p={p} state={state} now={now} />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
