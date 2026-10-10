import type { ReactNode } from "react";
import type { IconName, Tone } from "../lib/phase";
import { Icon } from "./Icon";
import { TONE_STROKE, TONE_TEXT } from "./Status";

const ARCH = "M28 316 V132 A92 92 0 0 1 212 132 V316";

export function Gate({
  tone,
  icon,
  word,
  big,
  caption,
  progress = null,
  pulse = false,
  bars = false,
  seam = false,
  className = "",
  children,
}: {
  tone: Tone;
  icon: IconName;
  word: string;
  big?: string;
  caption?: string;
  progress?: number | null;
  pulse?: boolean;
  bars?: boolean;
  seam?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const p = progress === null ? null : Math.min(1, Math.max(0, progress));
  const stroke = TONE_STROKE[tone];
  return (
    <figure className={`@container relative mx-auto aspect-[240/320] w-full ${className}`} aria-label={`${word}${big ? `, ${big}` : ""}`}>
      <svg viewBox="0 0 240 320" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <clipPath id="gate-inside">
            <path d="M28 320 V132 A92 92 0 0 1 212 132 V320 Z" />
          </clipPath>
        </defs>
        <path d="M28 320 V132 A92 92 0 0 1 212 132 V320 Z" fill={stroke} fillOpacity={tone === "quiet" ? 0.06 : 0.1} />
        {bars && (
          <g clipPath="url(#gate-inside)" stroke={stroke} strokeOpacity={0.28} strokeWidth={6}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <line key={`v${i}`} x1={48 + i * 29} y1={30} x2={48 + i * 29} y2={320} />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <line key={`h${i}`} x1={20} y1={150 + i * 46} x2={220} y2={150 + i * 46} />
            ))}
          </g>
        )}
        {seam && (
          <g stroke={stroke} strokeOpacity={0.25} strokeWidth={3} fill="none">
            <line x1={120} y1={236} x2={120} y2={320} />
            <path d="M58 320 V250 M182 320 V250" />
            <circle cx={108} cy={282} r={3} fill={stroke} />
            <circle cx={132} cy={282} r={3} fill={stroke} />
          </g>
        )}
        <path d={ARCH} fill="none" stroke="var(--color-line)" strokeWidth={14} strokeLinecap="round" />
        <path
          d={ARCH}
          fill="none"
          stroke={stroke}
          strokeWidth={14}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={p === null ? "1 0" : `${p} 1`}
          className={pulse ? "gate-pulse" : ""}
          style={{ transition: "stroke-dasharray 900ms linear" }}
        />
        <path d="M108 30 h24 l-4 16 h-16 z" fill={stroke} />
      </svg>
      <figcaption className="absolute inset-x-[16%] top-[30%] bottom-[6%] flex flex-col items-center text-center">
        <span className={`inline-flex items-center gap-2 ${TONE_TEXT[tone]}`}>
          <Icon name={icon} size={30} strokeWidth={2.4} className="size-[11cqw]" />
        </span>
        <span className={`mt-[2cqw] text-[8.6cqw] leading-[1.05] font-[800] ${TONE_TEXT[tone]}`}>{word}</span>
        {big && (
          <span className="mt-[3cqw] tabular-nums text-[22cqw] leading-none font-[800] text-ink" aria-live="polite">
            {big}
          </span>
        )}
        {caption && <span className="mt-[2.5cqw] max-w-[18ch] text-[max(0.9rem,4.4cqw)] leading-snug text-ink-soft">{caption}</span>}
        {children}
      </figcaption>
    </figure>
  );
}
