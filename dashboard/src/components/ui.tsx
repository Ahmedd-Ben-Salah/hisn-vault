import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import type { IconName, Tone } from "../lib/phase";
import { Icon } from "./Icon";

export function Logo({ size = 30, dark = false }: { size?: number; dark?: boolean }) {
  const fill = dark ? "#FFFFFF" : "var(--ink)";
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <rect x="16" y="12" width="22" height="76" rx="6" fill={fill} />
        <rect x="36" y="40" width="28" height="18" fill={fill} />
        <rect x="62" y="12" width="22" height="52" rx="6" fill={fill} />
        <rect x="62" y="74" width="22" height="14" rx="5" fill="var(--accent)" />
      </svg>
      <span className={`text-[26px] leading-none font-[900] tracking-tight lowercase ${dark ? "text-paper" : "text-ink"}`}>hisn</span>
    </span>
  );
}

export function PageTitle({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-[28px] leading-[1.05] font-[900] tracking-[-1px] md:text-[44px] md:tracking-[-1.5px]">{title}</h1>
        {lead && <p className="mt-3 text-[17px] text-ink-soft">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-10 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[22px] font-[800]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Card: 1.5 px line border, radius 28, padding 24 (padding left to the caller as before). */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border-[1.5px] border-line bg-paper ${className}`}>{children}</div>;
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel className={`p-6 ${className}`}>
      {title && <h3 className="mb-3 text-[18px] font-[800]">{title}</h3>}
      {children}
    </Panel>
  );
}

const TINT: Record<"soft" | "ok" | "wait" | "stop", string> = {
  soft: "bg-soft text-ink-2",
  ok: "bg-safe-wash text-safe",
  wait: "bg-hold-wash text-hold-text",
  stop: "bg-stop-wash text-stop-text",
};

/** Tinted panel: no border. */
export function Tinted({ tint = "soft", children, className = "" }: { tint?: keyof typeof TINT; children: ReactNode; className?: string }) {
  return <div className={`rounded-panel p-5 ${TINT[tint]} ${className}`}>{children}</div>;
}

type Look = "go" | "primary" | "dark" | "stop" | "stop-outline" | "plain" | "outline" | "quiet" | "link";

const LOOK: Record<Look, string> = {
  go: "bg-door text-paper hover:bg-ink",
  primary: "bg-door text-paper hover:bg-ink",
  dark: "bg-ink text-paper hover:bg-ink-2",
  stop: "bg-stop text-paper hover:bg-stop-text",
  "stop-outline": "border-2 border-stop text-stop-fg bg-paper hover:bg-stop-wash",
  plain: "border-2 border-ink bg-paper text-ink hover:bg-soft",
  outline: "border-2 border-ink bg-paper text-ink hover:bg-soft",
  quiet: "bg-soft text-ink hover:bg-line",
  link: "text-ink underline decoration-2 underline-offset-4 hover:text-door",
};

function cls(look: Look, big?: boolean, size?: "sm" | "md" | "lg") {
  const h = look === "link" ? "min-h-11 px-1" : big || size === "lg" ? "h-[54px] px-7" : size === "sm" ? "h-[42px] px-4 text-[15px]" : "h-[46px] px-5";
  return `inline-flex items-center justify-center gap-2 rounded-full text-[17px] font-[800] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${h} ${LOOK[look]}`;
}

export function Button({
  look = "go",
  icon,
  big,
  size,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { look?: Look; icon?: IconName; big?: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <button type="button" {...rest} className={`${cls(look, big, size)} ${className}`}>
      {icon && <Icon name={icon} size={big ? 20 : 18} strokeWidth={2.4} />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, look = "go", icon, big, size, children, className = "" }: { to: string; look?: Look; icon?: IconName; big?: boolean; size?: "sm" | "md" | "lg"; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`${cls(look, big, size)} ${className}`}>
      {icon && <Icon name={icon} size={big ? 20 : 18} strokeWidth={2.4} />}
      {children}
    </Link>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-card border-2 border-dashed border-border px-6 py-6">
      <Icon name={icon} size={26} className="mt-0.5 text-ink-soft" />
      <div>
        <p className="font-[800]">{title}</p>
        {children && <div className="mt-1 text-ink-soft">{children}</div>}
      </div>
    </div>
  );
}

/** Key-value row: muted label left, bold value right. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-t border-line py-3 first:border-t-0 first:pt-0">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-right font-[700] break-words">{children}</dd>
    </div>
  );
}

const AVATAR_TONE: Record<Tone | "dark", string> = {
  quiet: "bg-soft text-ink",
  door: "bg-soft text-ink",
  ice: "bg-soft text-ink",
  dark: "bg-ink text-paper",
  hold: "bg-hold-wash text-hold",
  stop: "bg-stop-wash text-stop-fg",
  safe: "bg-safe-wash text-safe",
};

export function Avatar({ name, size = 46, tone = "quiet" }: { name: string; size?: 40 | 46 | 54 | 76; tone?: Tone | "dark" }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const fs = size >= 76 ? 30 : size >= 54 ? 22 : 18;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-[800] ${AVATAR_TONE[tone]}`}
      style={{ width: size, height: size, fontSize: fs }}
    >
      {initial}
    </span>
  );
}

/** First 8 and last 8 characters, with the ends on a soft chip. Click to see it in full and copy. */
export function AddressText({ address, className = "" }: { address: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const short = address.length > 20;
  const head = address.slice(0, 8);
  const tail = address.slice(-8);
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 font-mono text-[15px] ${className}`}>
      {open || !short ? (
        <span className="break-all">{address}</span>
      ) : (
        <span>
          <span className="rounded-md bg-soft px-1 font-[700]">{head}</span>…<span className="rounded-md bg-soft px-1 font-[700]">{tail}</span>
        </span>
      )}
      {short && (
        <button
          type="button"
          className="min-h-8 rounded-full px-2 font-sans text-[13px] font-[700] text-ink-soft underline underline-offset-2 hover:text-door"
          onClick={() => {
            if (open) {
              void navigator.clipboard?.writeText(address).then(() => setCopied(true));
            } else setOpen(true);
          }}
        >
          {open ? (copied ? "Copied" : "Copy") : "Show all"}
        </button>
      )}
    </span>
  );
}

/** Track with a start and end label above it. No ticking counter. */
export function Progress({ value, from, to, onWait }: { value: number; from?: ReactNode; to?: ReactNode; onWait?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      {(from || to) && (
        <div className="mb-2 flex justify-between text-[14px] font-[600]">
          <span>{from}</span>
          <span>{to}</span>
        </div>
      )}
      <div className={`h-2.5 overflow-hidden rounded-full ${onWait ? "bg-hold-track" : "bg-soft"}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
