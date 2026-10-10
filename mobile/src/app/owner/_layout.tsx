import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router/tabs";
import type { ColorValue } from "react-native";
import { useSession } from "../../state/session";
import { C, F } from "../../ui/theme";

type Icon = keyof typeof Ionicons.glyphMap;
const icon = (name: Icon) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function OwnerTabs() {
  const { source } = useSession();
  const hasPuckSim = !!source.sim;
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
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarIcon: icon("list-outline") }} />
      <Tabs.Screen name="send" options={{ title: "Send", tabBarIcon: icon("paper-plane-outline") }} />
      <Tabs.Screen name="puck" options={{ title: "Puck", tabBarIcon: icon("hardware-chip-outline"), href: hasPuckSim ? undefined : null }} />
      <Tabs.Screen name="protection" options={{ title: "Protection", tabBarIcon: icon("shield-checkmark-outline") }} />
    </Tabs>
  );
}
