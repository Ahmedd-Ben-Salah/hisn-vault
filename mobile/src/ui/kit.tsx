import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { C, F, R, TONE_BG, TONE_FG, type Tone } from "./theme";

export type IconName = keyof typeof Ionicons.glyphMap;

export function T({
  children,
  size = 16,
  weight = "regular",
  color = C.ink,
  style,
  lines,
}: {
  children: ReactNode;
  size?: number;
  weight?: keyof typeof F;
  color?: string;
  style?: StyleProp<TextStyle>;
  lines?: number;
}) {
  return (
    <Text numberOfLines={lines} style={[{ fontFamily: F[weight], fontSize: size, color, lineHeight: Math.round(size * 1.3) }, style]}>
      {children}
    </Text>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <T size={28} weight="black" style={{ letterSpacing: -1, lineHeight: 32 }}>
        {children}
      </T>
      {sub ? (
        <T size={16} color={C.muted} style={{ marginTop: 6 }}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

export function Screen({ children, header, scroll = true }: { children: ReactNode; header?: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 20 }}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Look = "primary" | "dark" | "quiet" | "outline" | "stop" | "stopOutline";

const LOOK: Record<Look, { bg: string; fg: string; border?: string }> = {
  primary: { bg: C.accent, fg: C.onAccent },
  dark: { bg: C.ink, fg: C.bg },
  quiet: { bg: C.soft, fg: C.ink },
  outline: { bg: C.bg, fg: C.ink, border: C.ink },
  stop: { bg: C.stop, fg: C.bg },
  stopOutline: { bg: C.bg, fg: C.stopFg, border: C.stop },
};

export function Button({
  children,
  onPress,
  look = "primary",
  icon,
  big,
  disabled,
  busy,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  look?: Look;
  icon?: IconName;
  big?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const l = LOOK[look];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: big ? 62 : 48,
          paddingHorizontal: 22,
          borderRadius: R.pill,
          backgroundColor: l.bg,
          borderWidth: l.border ? 2 : 0,
          borderColor: l.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={l.fg} /> : icon ? <Ionicons name={icon} size={20} color={l.fg} /> : null}
      <T size={17} weight="heavy" color={l.fg}>
        {children}
      </T>
    </Pressable>
  );
}

export function Card({ title, children, style }: { title?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ borderWidth: 1.5, borderColor: C.line, borderRadius: R.card, padding: 20, backgroundColor: C.bg }, style]}>
      {title ? (
        <T size={18} weight="heavy" style={{ marginBottom: 10 }}>
          {title}
        </T>
      ) : null}
      {children}
    </View>
  );
}

const TINT = {
  soft: { bg: C.soft, fg: C.ink2 },
  ok: { bg: C.okBg, fg: C.okText },
  wait: { bg: C.waitBg, fg: C.waitText },
  stop: { bg: C.stopBg, fg: C.stopText },
} as const;

export type Tint = keyof typeof TINT;

export function Tinted({ tint = "soft", children, style }: { tint?: Tint; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: TINT[tint].bg, borderRadius: R.panel, padding: 18 }, style]}>{children}</View>;
}

export const tintText = (t: Tint) => TINT[t].fg;

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <T color={C.muted}>{label}</T>
      <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{typeof children === "string" ? <T weight="bold">{children}</T> : children}</View>
    </View>
  );
}

const AV: Record<Tone | "dark", { bg: string; fg: string }> = {
  quiet: { bg: C.soft, fg: C.ink },
  door: { bg: C.soft, fg: C.ink },
  ice: { bg: C.soft, fg: C.ink },
  dark: { bg: C.ink, fg: C.bg },
  hold: { bg: C.waitBg, fg: C.waitFg },
  stop: { bg: C.stopBg, fg: C.stopFg },
  safe: { bg: C.okBg, fg: C.okFg },
};

export function Avatar({ name, size = 46, tone = "quiet" }: { name: string; size?: number; tone?: Tone | "dark" }) {
  const a = AV[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: a.bg, alignItems: "center", justifyContent: "center" }}>
      <T size={Math.round(size * 0.4)} weight="heavy" color={a.fg}>
        {(name.trim()[0] ?? "?").toUpperCase()}
      </T>
    </View>
  );
}

export function Chip({ tone, word, icon }: { tone: Tone; word: string; icon?: IconName }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: TONE_BG[tone], borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
      {icon ? <Ionicons name={icon} size={14} color={TONE_FG[tone]} /> : null}
      <T size={14} weight="heavy" color={TONE_FG[tone]}>
        {word}
      </T>
    </View>
  );
}

export function Progress({ value, from, to, onWait }: { value: number; from?: string; to?: string; onWait?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View>
      {from || to ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <T size={14} weight="semibold" color={onWait ? C.waitText : C.ink}>
            {from ?? ""}
          </T>
          <T size={14} weight="semibold" color={onWait ? C.waitText : C.ink}>
            {to ?? ""}
          </T>
        </View>
      ) : null}
      <View style={{ height: 10, borderRadius: 5, backgroundColor: onWait ? C.waitTrack : C.soft, overflow: "hidden" }}>
        <View style={{ height: 10, borderRadius: 5, width: `${pct}%`, backgroundColor: C.ink }} />
      </View>
    </View>
  );
}

/** First 8 and last 8 characters; tap to see it all and copy. */
export function Address({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const short = value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
  return (
    <Pressable
      onPress={() => {
        if (!open) return setOpen(true);
        void Clipboard.setStringAsync(value).then(() => setCopied(true));
      }}
      accessibilityLabel={open ? "Copy address" : "Show full address"}
    >
      <T size={15} weight="semibold" style={{ fontFamily: undefined }}>
        {open ? value : short}
      </T>
      <T size={13} weight="bold" color={C.muted}>
        {open ? (copied ? "Copied" : "Tap to copy") : "Tap to see all"}
      </T>
    </Pressable>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ borderWidth: 2, borderStyle: "dashed", borderColor: C.border, borderRadius: R.card, padding: 22 }}>
      <T weight="heavy">{title}</T>
      {children ? <T color={C.muted} style={{ marginTop: 4 }}>{children}</T> : null}
    </View>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ marginTop: 26 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <T size={22} weight="heavy">
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  gap: { gap: 12 },
});
