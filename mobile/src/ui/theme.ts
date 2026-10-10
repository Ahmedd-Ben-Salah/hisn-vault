// Design tokens from handoff/design/tokens.css. Components use these names, never raw hex.
export const C = {
  ink: "#0B1F3A",
  ink2: "#33455E",
  muted: "#4B5B73",
  line: "#E3E8EF",
  border: "#C7D0DD",
  soft: "#EEF2F8",
  bg: "#FFFFFF",
  accent: "#1D4ED8",
  onAccent: "#FFFFFF",
  waitBg: "#FBF0D9",
  waitTrack: "#EBDDB4",
  waitFg: "#6B4E00",
  waitText: "#3D3210",
  stop: "#B42318",
  stopFg: "#B02A15",
  stopBg: "#FBE9E5",
  stopText: "#7A1D0E",
  okFg: "#0F6B48",
  okBg: "#DDF1E7",
  okText: "#0F4A33",
  online: "#12A150",
} as const;

export const F = {
  regular: "Figtree_400Regular",
  medium: "Figtree_500Medium",
  semibold: "Figtree_600SemiBold",
  bold: "Figtree_700Bold",
  heavy: "Figtree_800ExtraBold",
  black: "Figtree_900Black",
} as const;

export const R = { pill: 999, card: 28, panel: 24, input: 16 } as const;

export type Tone = "safe" | "hold" | "stop" | "ice" | "door" | "quiet";

export const TONE_FG: Record<Tone, string> = {
  safe: C.okFg,
  hold: C.waitFg,
  stop: C.stopFg,
  ice: C.ink2,
  door: C.accent,
  quiet: C.muted,
};

export const TONE_BG: Record<Tone, string> = {
  safe: C.okBg,
  hold: C.waitBg,
  stop: C.stopBg,
  ice: C.soft,
  door: C.soft,
  quiet: C.soft,
};
