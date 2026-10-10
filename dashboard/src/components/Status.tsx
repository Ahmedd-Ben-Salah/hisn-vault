import type { IconName, Tone } from "../lib/phase";
import { Icon } from "./Icon";

export const TONE_TEXT: Record<Tone, string> = {
  safe: "text-safe",
  hold: "text-hold",
  stop: "text-stop",
  ice: "text-ice",
  door: "text-door",
  quiet: "text-ink-soft",
};

export const TONE_WASH: Record<Tone, string> = {
  safe: "bg-safe-wash",
  hold: "bg-hold-wash",
  stop: "bg-stop-wash",
  ice: "bg-ice-wash",
  door: "bg-door-wash",
  quiet: "bg-soft",
};

export const TONE_STROKE: Record<Tone, string> = {
  safe: "var(--color-safe)",
  hold: "var(--color-hold-fill)",
  stop: "var(--color-stop)",
  ice: "var(--color-ice)",
  door: "var(--color-door)",
  quiet: "var(--color-ink-soft)",
};

export function StatusChip({ tone, icon, word, size = "md" }: { tone: Tone; icon: IconName; word: string; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2.5 py-0.5 text-[13px] gap-1" : "px-3 py-1 text-[14px] gap-1.5";
  return (
    <span className={`inline-flex items-center rounded-full font-[800] whitespace-nowrap ${pad} ${TONE_TEXT[tone]} ${TONE_WASH[tone]}`}>
      <Icon name={icon} size={size === "sm" ? 14 : 16} strokeWidth={2.4} />
      {word}
    </span>
  );
}

export function TierChip({ tier }: { tier: "INSTANT" | "WAIT" | "APPROVAL" }) {
  if (tier === "INSTANT") return <StatusChip tone="safe" icon="bolt" word="Instant" size="sm" />;
  if (tier === "WAIT") return <StatusChip tone="hold" icon="hourglass" word="Waits" size="sm" />;
  return <StatusChip tone="hold" icon="person" word="Needs approval" size="sm" />;
}
