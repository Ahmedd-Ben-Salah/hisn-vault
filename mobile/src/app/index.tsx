import { router } from "expo-router";
import { useRef, useState } from "react";
import { FlatList, Pressable, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ACCOUNTS, type Account } from "../state/accounts";
import { useSession } from "../state/session";
import { Avatar, Button, T } from "../ui/kit";
import { Logo } from "../ui/parts";
import { C, R } from "../ui/theme";

function open(a: Account, setAccount: (id: string) => void) {
  setAccount(a.id);
  router.replace(a.role === "owner" ? "/owner" : "/guardian");
}

/** "Who is using this phone?" Swipe between the demo people and tap one. No passwords. */
export default function Accounts() {
  const { width } = useWindowDimensions();
  const { setAccount, account, settings } = useSession();
  const start = Math.max(0, ACCOUNTS.findIndex((a) => a.id === account?.id));
  const [index, setIndex] = useState(start);
  const list = useRef<FlatList<Account>>(null);
  const cardW = width - 40;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 20, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Logo size={32} />
        <T size={30} weight="black" style={{ letterSpacing: -1 }}>
          hisn
        </T>
      </View>
      <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
        <T size={28} weight="black" style={{ letterSpacing: -1 }}>
          Who is using this phone?
        </T>
        <T color={C.muted} style={{ marginTop: 6 }}>
          {settings.mode === "demo" ? "Demo accounts, no password." : "Live mode: guardians sign with the key saved on this phone."}
        </T>
      </View>

      <FlatList
        ref={list}
        data={ACCOUNTS}
        horizontal
        pagingEnabled
        snapToInterval={width}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        initialNumToRender={ACCOUNTS.length}
        windowSize={ACCOUNTS.length * 2 + 1}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(a) => a.id}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flexGrow: 0, marginTop: 24 }}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: 20 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use ${item.name}'s account`}
              onPress={() => open(item, setAccount)}
              style={({ pressed }) => ({
                width: cardW,
                borderRadius: R.card,
                padding: 26,
                backgroundColor: item.role === "owner" ? C.ink : C.soft,
                opacity: pressed ? 0.9 : 1,
                minHeight: 300,
                justifyContent: "space-between",
              })}
            >
              <View>
                <Avatar name={item.name} size={76} tone={item.role === "owner" ? "quiet" : "dark"} />
                <T size={36} weight="black" color={item.role === "owner" ? C.bg : C.ink} style={{ marginTop: 18, letterSpacing: -1 }}>
                  {item.name}
                </T>
                <View style={{ alignSelf: "flex-start", marginTop: 8, backgroundColor: item.role === "owner" ? C.accent : C.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                  <T size={13} weight="heavy" color={item.role === "owner" ? C.bg : C.ink}>
                    {item.role === "owner" ? "Owner" : "Guardian"}
                  </T>
                </View>
                <T size={17} color={item.role === "owner" ? C.soft : C.ink2} style={{ marginTop: 14 }}>
                  {item.about}
                </T>
              </View>
            </Pressable>
          </View>
        )}
      />

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 16 }}>
        {ACCOUNTS.map((a, i) => (
          <Pressable
            key={a.id}
            accessibilityLabel={`Show ${a.name}`}
            onPress={() => {
              list.current?.scrollToIndex({ index: i, animated: true });
              setIndex(i);
            }}
            hitSlop={10}
          >
            <View style={{ width: i === index ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? C.ink : C.border }} />
          </Pressable>
        ))}
      </View>

      <View style={{ padding: 20, gap: 12, marginTop: "auto" }}>
        <Button big onPress={() => open(ACCOUNTS[index], setAccount)}>
          {`Continue as ${ACCOUNTS[index].name}`}
        </Button>
        <Button look="quiet" icon="settings-outline" onPress={() => router.push("/settings")}>
          {settings.mode === "demo" ? "Settings (demo mode)" : "Settings (live mode)"}
        </Button>
      </View>
    </SafeAreaView>
  );
}
