import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router/tabs";
import type { ColorValue } from "react-native";
import { phaseOf } from "../../core/lib/phase";
import { useSnapshot } from "../../state/session";
import { C, F } from "../../ui/theme";

type Icon = keyof typeof Ionicons.glyphMap;
const icon = (name: Icon) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function GuardianTabs() {
  const { payments, state, now } = useSnapshot();
  const alerts = payments.filter((p) => phaseOf(p, state, now).live).length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontFamily: F.bold, fontSize: 12 },
        tabBarStyle: { borderTopColor: C.line, height: 64, paddingBottom: 8, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Alerts", tabBarIcon: icon("notifications-outline"), tabBarBadge: alerts > 0 ? alerts : undefined }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: icon("list-outline") }} />
    </Tabs>
  );
}
