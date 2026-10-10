import { NavLink, Outlet } from "react-router";
import type { DeviceView } from "@hisn/shared";
import { useSnapshot, useSource } from "../data/store";
import { accountStatus, type IconName } from "../lib/phase";
import { Icon } from "./Icon";
import { Avatar, Logo } from "./ui";
import { SimPanel } from "./SimPanel";
import { TONE_TEXT } from "./Status";

const NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: "/", label: "Home", icon: "gate" },
  { to: "/payments", label: "Payments", icon: "list" },
  { to: "/people", label: "People", icon: "people" },
  { to: "/protection", label: "Protection", icon: "shield" },
  { to: "/helper", label: "Helper", icon: "chat" },
];

const EXTRA: Array<{ to: string; label: string }> = [
  { to: "/log", label: "Public record" },
  { to: "/demo", label: "Side by side" },
  { to: "/connect", label: "Hisn server" },
];

const ROLE_WORD: Record<DeviceView["role"], string> = {
  puck: "Puck",
  watcher: "Alarm light",
  guardian: "Guardian",
  page: "Guardian phone",
};

export function DeviceDots() {
  const { state } = useSnapshot();
  if (state.devices.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Devices">
      {state.devices.map((d) => (
        <li key={d.id} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${d.online ? "bg-online" : "border-2 border-ink-soft bg-transparent"}`} aria-hidden="true" />
          <span className="font-bold">{ROLE_WORD[d.role]}</span>
          <span className={d.online ? "text-safe" : "text-ink-soft"}>{d.online ? "online" : "offline"}</span>
        </li>
      ))}
    </ul>
  );
}

function Banner() {
  const { connection } = useSnapshot();
  const mock = useSource().kind === "mock";
  return (
    <>
      {connection === "offline" && (
        <div className="border-b border-ice/30 bg-ice-wash px-5 py-2.5 text-ice" role="status">
          <p className="mx-auto flex max-w-7xl items-center gap-2 font-bold">
            <Icon name="wifi-off" size={18} />
            Our server is off. The vault and the Hedera network keep working: a confirmed payment still releases on time, and a guardian can still stop it.
          </p>
        </div>
      )}
      {connection === "connecting" && (
        <div className="border-b border-line bg-paper px-5 py-2 text-ink-soft" role="status">
          <p className="mx-auto max-w-7xl">Connecting to the relayer…</p>
        </div>
      )}
      {mock && (
        <div className="border-b border-dashed border-ink-soft/40 bg-paper px-5 py-2 text-ink-soft" role="note">
          <p className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
            <Icon name="warn" size={16} />
            <span>
              <strong className="text-ink">Simulated data.</strong> Nothing on this screen is on testnet.
            </span>
          </p>
        </div>
      )}
    </>
  );
}

export function Shell() {
  const snap = useSnapshot();
  const status = accountStatus(snap.state, snap.payments, snap.now);
  const reconnecting = snap.connection === "offline" || snap.connection === "connecting";
  return (
    <div className="flex min-h-dvh flex-col pb-[76px] md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-paper focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-[72px] max-w-[1140px] items-center gap-6 px-5 xl:px-0">
          <NavLink to="/" aria-label="Hisn, home" className="rounded-lg">
            <Logo size={30} />
          </NavLink>
          <nav className="mx-auto hidden md:block" aria-label="Main">
            <ul className="flex gap-1">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === "/"}
                    className={({ isActive }) =>
                      `inline-flex min-h-11 items-center rounded-full px-[18px] text-[16px] font-[700] transition-colors ${
                        isActive ? "bg-soft text-ink" : "text-ink-soft hover:text-ink"
                      }`
                    }
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            {reconnecting && snap.connection !== "mock" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-hold-wash px-3 py-1 text-[13px] font-[800] text-hold" role="status">
                <Icon name="wifi-off" size={14} strokeWidth={2.4} />
                Reconnecting
              </span>
            )}
            <span className={`hidden items-center gap-1.5 text-[14px] font-[800] sm:inline-flex ${TONE_TEXT[status.tone]}`}>
              <Icon name={status.icon} size={16} strokeWidth={2.4} />
              {status.word}
            </span>
            <span className="rounded-full border-[1.5px] border-border px-3 py-1 text-[13px] font-[800] text-ink-soft">{snap.state.vaultId ? "Testnet" : snap.connection === "mock" ? "Testnet" : "Local chain"}</span>
            <Avatar name="Owner" size={40} tone="dark" />
          </div>
        </div>
      </header>
      <Banner />
      <main id="main" className="mx-auto w-full max-w-[1140px] flex-1 px-5 py-8 md:py-10 xl:px-0">
        <Outlet />
      </main>
      <footer className="mx-auto hidden w-full max-w-[1140px] flex-wrap items-center gap-x-6 gap-y-2 border-t border-line px-5 py-6 text-[14px] text-ink-soft md:flex xl:px-0">
        <DeviceDots />
        <span className="ml-auto" />
        {EXTRA.map((e) => (
          <NavLink key={e.to} to={e.to} className="font-[700] underline-offset-4 hover:text-door hover:underline">
            {e.label}
          </NavLink>
        ))}
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper md:hidden" aria-label="Main">
        <ul className="grid grid-cols-5">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `flex min-h-[64px] flex-col items-center justify-center gap-1 text-[12px] font-[700] ${isActive ? "text-ink" : "text-ink-soft"}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`rounded-full px-4 py-1 ${isActive ? "bg-soft" : ""}`}>
                      <Icon name={n.icon} size={20} />
                    </span>
                    {n.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <SimPanel />
    </div>
  );
}
