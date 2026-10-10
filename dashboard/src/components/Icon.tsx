import type { IconName } from "../lib/phase";

const PATHS: Record<IconName, string> = {
  shield: "M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z M8.5 12l2.5 2.5 4.5-5",
  hourglass: "M6.5 3h11 M6.5 21h11 M7.5 3c0 4.5 4.5 6 4.5 9s-4.5 4.5-4.5 9 M16.5 3c0 4.5-4.5 6-4.5 9s4.5 4.5 4.5 9 M9.5 18.5h5",
  hand: "M8 13V6.5a1.5 1.5 0 0 1 3 0V12 M11 11V4.5a1.5 1.5 0 0 1 3 0V12 M14 11V6a1.5 1.5 0 0 1 3 0v7 M8 13v-2a1.5 1.5 0 0 0-3 0v3.5c0 4 2.9 6.5 6.5 6.5h.5c3.4 0 5-2.6 5-6v-2",
  snow: "M12 2.5v19 M3.8 7.25l16.4 9.5 M3.8 16.75l16.4-9.5 M9.5 4.5 12 7l2.5-2.5 M9.5 19.5 12 17l2.5 2.5",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
  cross: "M6 6l12 12 M18 6 6 18",
  person: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 21c.6-4 3.6-6.5 7.5-6.5s6.9 2.5 7.5 6.5",
  key: "M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2 M13.2 12.8 21 20.5 M17.5 17l2-2 M15.5 15l1.5-1.5",
  bolt: "M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3.5 2",
  warn: "M12 3.5 2.5 20h19L12 3.5Z M12 10v4.5 M12 17.2v.3",
  send: "M3.5 11.5 20.5 4l-7.5 17-2.5-7-7-2.5Z M10.5 14 20.5 4",
  lock: "M6 10.5h12v10H6z M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3",
  list: "M8.5 6.5h12 M8.5 12h12 M8.5 17.5h12 M4 6.5h.5 M4 12h.5 M4 17.5h.5",
  chat: "M4 5.5h16v11H10l-4.5 3.5V16.5H4z M8 10h8 M8 13h5",
  gate: "M5 21V10a7 7 0 0 1 14 0v11 M9.5 21v-6h5v6 M3 21h18",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20c.5-3.6 3-5.8 6.5-5.8s6 2.2 6.5 5.8 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.5c2 .7 3.2 2.6 3.5 5.5",
  split: "M12 3v18 M3.5 7.5h5 M3.5 12h5 M15.5 7.5h5 M15.5 12h5",
  download: "M12 3.5v12 M7 10.5l5 5 5-5 M4.5 20.5h15",
  "wifi-off": "M3 3l18 18 M8.5 16.5a5 5 0 0 1 7 0 M5 13a10 10 0 0 1 5.4-2.8 M19 13a10 10 0 0 0-2.2-1.6 M2 9.5a15 15 0 0 1 4.6-3 M22 9.5A15 15 0 0 0 11 5.6 M12 20h.01",
};

export function Icon({ name, size = 20, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
