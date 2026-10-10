import type { ReactNode } from "react";
import { hashscanContract, hashscanSchedule, hashscanTopic, hashscanTx } from "@hisn/shared";
import { useSnapshot, useSource } from "../data/store";

function Out({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`font-bold text-door underline decoration-door/30 underline-offset-4 hover:decoration-door ${className}`}
    >
      {children}
    </a>
  );
}

type OffChain = "simulated" | "local chain" | null;

export function useOffChain(): OffChain {
  const source = useSource();
  const { state } = useSnapshot();
  if (source.kind === "mock") return "simulated";
  return state.vault && !state.vaultId ? "local chain" : null;
}

function Simulated({ children, why }: { children: ReactNode; why: OffChain }) {
  return (
    <span className="text-ink-soft" title={`${why === "local chain" ? "Local test chain" : "Simulated data"}: there is nothing to open on HashScan`}>
      {children} <span className="text-sm">({why})</span>
    </span>
  );
}

export function TxLink({ tx, children = "HashScan" }: { tx?: string; children?: ReactNode }) {
  const off = useOffChain();
  if (!tx) return null;
  if (off) return <Simulated why={off}>{children}</Simulated>;
  return <Out href={hashscanTx(tx)}>{children}</Out>;
}

export function ScheduleLink({ schedule }: { schedule: string | null }) {
  const off = useOffChain();
  if (!schedule) return null;
  if (off) return <Simulated why={off}>Network timer</Simulated>;
  return <Out href={hashscanSchedule(schedule)}>Network timer on HashScan</Out>;
}

export function VaultLink() {
  const { state } = useSnapshot();
  const off = useOffChain();
  if (!state.vault) return null;
  if (off) return <Simulated why={off}>Vault contract</Simulated>;
  return <Out href={hashscanContract(state.vault)}>Vault contract on HashScan</Out>;
}

export function TopicLink() {
  const { state } = useSnapshot();
  const off = useOffChain();
  if (!state.topicId) return null;
  if (off) return <Simulated why={off}>Public log {state.topicId}</Simulated>;
  return <Out href={hashscanTopic(state.topicId)}>Public log {state.topicId} on HashScan</Out>;
}
