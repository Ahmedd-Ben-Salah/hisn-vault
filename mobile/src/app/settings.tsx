import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { useSession } from "../state/session";
import { Address, Button, Card, Screen, T, Tinted, Title } from "../ui/kit";
import { C, F } from "../ui/theme";

const input = { height: 52, borderRadius: 16, borderWidth: 2, borderColor: C.border, paddingHorizontal: 14, fontFamily: F.semibold, fontSize: 15, color: C.ink } as const;

export default function Settings() {
  const { settings, saveSettings, resetDemo, account, guardianKey, source } = useSession();
  const [url, setUrl] = useState(settings.relayerUrl);
  const [token, setToken] = useState(settings.relayerToken);
  const [sim, setSim] = useState(settings.simUrl);
  const [keyText, setKeyText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Screen
      header={
        <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 }}>
            <Ionicons name="chevron-back" size={20} color={C.muted} />
            <T weight="bold" color={C.muted}>
              Back
            </T>
          </Pressable>
        </View>
      }
    >
      <Title sub="Demo mode works anywhere with no server. Live mode connects to your relayer on Hedera testnet.">Settings</Title>

      <Card title="Mode">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["demo", "live"] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: settings.mode === m }}
              onPress={() => {
                if (m === "live" && !url.trim()) {
                  setMsg("Enter the relayer address first, then choose Live.");
                  return;
                }
                void saveSettings({ ...settings, mode: m, relayerUrl: url.trim(), relayerToken: token.trim(), simUrl: sim.trim() });
                setMsg(m === "demo" ? "Demo mode on." : "Live mode on. Connecting…");
              }}
              style={{ flex: 1, height: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: settings.mode === m ? C.ink : C.soft }}
            >
              <T weight="heavy" color={settings.mode === m ? C.bg : C.ink}>
                {m === "demo" ? "Demo" : "Live"}
              </T>
            </Pressable>
          ))}
        </View>
        <T size={14} color={C.muted} style={{ marginTop: 10 }}>
          Now: {source.kind === "mock" ? "demo (simulated vault, nothing is on testnet)" : `live, ${settings.relayerUrl}`}
        </T>
      </Card>

      <Card title="Relayer (live mode)" style={{ marginTop: 14 }}>
        <T size={14} weight="bold" color={C.muted} style={{ marginBottom: 6 }}>
          Address, for example http://192.168.1.20:8787
        </T>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://…:8787" placeholderTextColor={C.muted} style={input} />
        <T size={14} weight="bold" color={C.muted} style={{ marginTop: 12, marginBottom: 6 }}>
          Token (RELAYER_API_TOKEN)
        </T>
        <TextInput value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="local-dev" placeholderTextColor={C.muted} style={input} />
        <T size={14} weight="bold" color={C.muted} style={{ marginTop: 12, marginBottom: 6 }}>
          Device simulator (optional, plays the puck)
        </T>
        <TextInput value={sim} onChangeText={setSim} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://…:8790" placeholderTextColor={C.muted} style={input} />
        <Button
          look="dark"
          style={{ marginTop: 14 }}
          onPress={() => {
            if (!url.trim()) return setMsg("Enter the relayer address.");
            void saveSettings({ ...settings, mode: "live", relayerUrl: url.trim(), relayerToken: token.trim(), simUrl: sim.trim() });
            setMsg("Saved. Live mode on.");
          }}
        >
          Save and use live mode
        </Button>
        <T size={13} color={C.muted} style={{ marginTop: 8 }}>
          The phone and the laptop must be on the same Wi-Fi. Use the laptop&apos;s address, not localhost.
        </T>
      </Card>

      {account?.role === "guardian" ? (
        <Card title={`${account.name}'s guardian key`} style={{ marginTop: 14 }}>
          <T size={15}>
            In live mode, {account.name} stops and approves by signing with a key kept in this phone&apos;s secure storage. The vault must list its address as a guardian.
          </T>
          {guardianKey.address ? (
            <View style={{ marginTop: 10, gap: 10 }}>
              <Address value={guardianKey.address} />
              <Button
                look="stopOutline"
                onPress={() =>
                  Alert.alert("Remove this key?", "Without it this phone cannot stop payments in live mode.", [
                    { text: "Keep it", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => void guardianKey.remove() },
                  ])
                }
              >
                Remove key
              </Button>
            </View>
          ) : (
            <View style={{ marginTop: 10, gap: 10 }}>
              <Button look="dark" onPress={() => void guardianKey.create().then((a) => setMsg(`New key ${a}. Send this address to the owner so it can be added.`))}>
                Create a new key
              </Button>
              <TextInput value={keyText} onChangeText={setKeyText} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Or paste an existing private key" placeholderTextColor={C.muted} style={input} />
              <Button
                look="outline"
                disabled={!keyText.trim()}
                onPress={() =>
                  void guardianKey
                    .importKey(keyText)
                    .then((a) => {
                      setKeyText("");
                      setMsg(`Key saved for ${a}.`);
                    })
                    .catch(() => setMsg("That is not a valid private key."))
                }
              >
                Use this key
              </Button>
            </View>
          )}
        </Card>
      ) : null}

      {source.kind === "mock" ? (
        <Card title="Demo" style={{ marginTop: 14 }}>
          <T size={15}>Start the demo again with the sample history and no waiting payments.</T>
          <Button
            look="quiet"
            style={{ marginTop: 10 }}
            onPress={() => {
              resetDemo();
              setMsg("The demo started again.");
            }}
          >
            Restart the demo
          </Button>
        </Card>
      ) : null}

      {msg ? (
        <Tinted style={{ marginTop: 14 }}>
          <T weight="bold">{msg}</T>
        </Tinted>
      ) : null}

      <Button look="quiet" icon="swap-horizontal" style={{ marginTop: 18 }} onPress={() => router.replace("/")}>
        Switch account
      </Button>
    </Screen>
  );
}
