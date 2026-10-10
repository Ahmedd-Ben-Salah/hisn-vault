import { EventEmitter } from "node:events";
import { Contract, getAddress } from "ethers";
import {
  type PaymentView,
  type ChangeView,
  type StateView,
  type TimelineEntry,
  type DeviceView,
  type LimitsView,
  CHANGE_KIND_NAMES,
  ChangeKind,
  TIER_NAMES,
  STATUS_NAMES,
  SCHEDULE_SERVICE,
  HBAR,
  TINYBAR_TO_WEIBAR,
  evmAddressToEntityId,
  decodeChangeData,
  hashscanTx, type PqView } from "./shared.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { VaultClient } from "./chain/vault.js";
import type { ChainEvent, EventSource } from "./chain/events.js";
import type { Roles } from "./hcs.js";

const ERC20 = ["function balanceOf(address) view returns (uint256)"];

const PAYMENT_EVENTS = new Set(["Proposed", "Confirmed", "Executed", "Vetoed", "Cancelled", "Expired", "ScheduleFailed", "ScheduleDeleted"]);
const CHANGE_EVENTS = new Set(["ChangeProposed", "ChangeApproved", "ChangeVetoed", "ChangeExecuted"]);
const STATE_EVENTS = new Set(["Frozen", "FreezeRenewed", "Unfrozen", "ChangeExecuted", "AgentPaid", "Deposited", "Associated"]);

type Immutables = StateView["immutables"];

function str(v: unknown): string {
  return typeof v === "bigint" ? v.toString() : String(v);
}

function stringifyFields(f: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (k !== "kind") out[k] = str(v);
  return out;
}

export class Indexer extends EventEmitter {
  readonly payments = new Map<number, PaymentView>();
  readonly changes = new Map<number, ChangeView>();
  readonly events: ChainEvent[] = [];
  private txs = new Set<string>();
  private seen = new Set<string>();
  private failed = new Set<number>();
  private payeeSince = new Map<string, number>();
  private immutables: Immutables | null = null;
  private stateCache: StateView | null = null;
  private stateAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private again = false;
  roles: Roles = { puck: "", guardians: [], watchers: [], agent: null };
  lastEventAt = 0;
  lastPollOk = 0;
  lastError: string | null = null;

  constructor(
    private cfg: Config,
    private db: Db,
    private vault: VaultClient,
    private source: EventSource,
    private devices: () => DeviceView[],
  ) {
    super();
  }

  get state(): StateView | null {
    if (!this.stateCache) return null;
    const frozen = Math.floor(Date.now() / 1000) < this.stateCache.frozenUntil;
    return { ...this.stateCache, frozen, devices: this.devices() };
  }

  knownTx(hash: string): boolean {
    return this.txs.has(hash.toLowerCase());
  }

  hasScheduleFailed(id: number): boolean {
    return this.failed.has(id);
  }

  async start(): Promise<void> {
    await this.loadRoles();
    await this.refreshState(true);
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.cfg.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      const evs = await this.source.poll();
      this.lastPollOk = Date.now();
      this.lastError = null;
      const pays = new Set<number>();
      const chgs = new Set<number>();
      let rolesDirty = false;
      let stateDirty = false;
      for (const e of evs) {
        if (this.seen.has(e.key)) continue;
        this.seen.add(e.key);
        this.events.push(e);
        this.txs.add(e.txHash.toLowerCase());
        this.lastEventAt = e.timestamp;
        if (PAYMENT_EVENTS.has(e.name) && e.args.id !== undefined) pays.add(Number(e.args.id));
        if (CHANGE_EVENTS.has(e.name)) chgs.add(Number(e.args.id));
        if (e.name === "ScheduleFailed") this.failed.add(Number(e.args.id));
        if (e.name === "ChangeExecuted" || e.name === "Frozen") rolesDirty = true;
        if (STATE_EVENTS.has(e.name) || PAYMENT_EVENTS.has(e.name)) stateDirty = true;
        this.emit("event", e);
      }
      if (rolesDirty) await this.loadRoles();
      for (const id of chgs) await this.refreshChange(id);
      if (rolesDirty) for (const id of this.changes.keys()) if (!chgs.has(id)) await this.refreshChange(id);
      for (const id of pays) await this.refreshPayment(id);
      if (rolesDirty) for (const id of this.pendingIds()) if (!pays.has(id)) await this.refreshPayment(id);
      await this.refreshState(stateDirty || rolesDirty);
      this.expireStale();
    } catch (e) {
      this.lastError = (e as Error).message;
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        void this.tick();
      }
    }
  }

  private pendingIds(): number[] {
    return [...this.payments.values()].filter((p) => p.status === "PENDING").map((p) => p.id);
  }

  private expireStale(): void {
    const now = Math.floor(Date.now() / 1000);
    const epoch = this.stateCache?.epoch ?? 0;
    for (const p of this.payments.values()) {
      if (p.status === "PENDING" && (now > p.expiresAt || p.epoch !== epoch)) {
        const next = { ...p, status: "EXPIRED" as const };
        this.payments.set(p.id, next);
        this.emit("payment", next);
      }
    }
    const keyEpoch = this.stateCache?.keyEpoch ?? 0;
    for (const c of this.changes.values()) {
      if (c.status === "PENDING" && (now > c.expiresAt || c.keyEpoch !== keyEpoch)) {
        const next = { ...c, status: "EXPIRED" as const };
        this.changes.set(c.id, next);
        this.emit("change", next);
      }
    }
  }

  async loadRoles(): Promise<void> {
    const r = this.vault.read;
    const [puck, guardians, watchers, agent] = await Promise.all([r.puck(), r.getGuardians(), r.getWatchers(), r.agent()]);
    this.roles = {
      puck: getAddress(puck),
      guardians: [...guardians].map((g: string) => getAddress(g)),
      watchers: [...watchers].map((w: string) => getAddress(w)),
      agent: agent === "0x0000000000000000000000000000000000000000" ? null : getAddress(agent),
    };
    this.payeeSince.clear();
  }

  label(address: string): string | null {
    const a = getAddress(address);
    return this.db.labels()[a] ?? this.cfg.labels[a] ?? null;
  }

  private async since(address: string): Promise<number> {
    const a = getAddress(address);
    if (!this.payeeSince.has(a)) this.payeeSince.set(a, Number(await this.vault.read.payeeSince(a)));
    return this.payeeSince.get(a)!;
  }

  private txFor(id: number, name: string): string | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.name === name && Number(e.args.id) === id) return e.txHash;
    }
    return undefined;
  }

  private executedBy(id: number, proposedTx?: string, confirmedTx?: string): string | undefined {
    const e = [...this.events].reverse().find((x) => x.name === "Executed" && Number(x.args.id) === id);
    if (!e) return undefined;
    const caller = String(e.args.caller).toLowerCase();
    if (caller === SCHEDULE_SERVICE.toLowerCase() || caller === this.cfg.vault.toLowerCase()) return "network";
    if (e.txHash === proposedTx || e.txHash === confirmedTx) return "vault";
    if (caller === this.vault.address.toLowerCase()) return "relayer";
    return "direct";
  }

  async refreshPayment(id: number): Promise<PaymentView> {
    let p = await this.vault.read.getPayment(id);
    for (let i = 0; i < 4 && Number(p.status) === 0; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      p = await this.vault.read.getPayment(id);
    }
    const to = getAddress(p.to);
    const txs: PaymentView["txs"] = {
      proposed: this.txFor(id, "Proposed"),
      confirmed: this.txFor(id, "Confirmed"),
      executed: this.txFor(id, "Executed"),
      vetoed: this.txFor(id, "Vetoed"),
      cancelled: this.txFor(id, "Cancelled") ?? this.txFor(id, "Expired"),
    };
    const view: PaymentView = {
      id,
      to,
      token: getAddress(p.token),
      amount: str(p.amount),
      tier: TIER_NAMES[Number(p.tier)],
      status: STATUS_NAMES[Number(p.status)],
      proposedAt: Number(p.proposedAt),
      releaseAt: Number(p.releaseAt),
      confirmFrom: Number(p.confirmFrom),
      expiresAt: Number(p.expiresAt),
      epoch: Number(p.epoch),
      confirmed: Boolean(p.confirmed),
      schedule: p.schedule === "0x0000000000000000000000000000000000000000" ? null : getAddress(p.schedule),
      label: this.label(to),
      newRecipient: (await this.since(to)) === 0,
      txs,
      executedBy: this.executedBy(id, txs.proposed, txs.confirmed),
    };
    if (!view.schedule) {
      const sch = [...this.events].reverse().find((e) => e.name === "Confirmed" && Number(e.args.id) === id);
      const addr = sch ? String(sch.args.schedule) : "";
      if (addr && addr !== "0x0000000000000000000000000000000000000000") view.schedule = getAddress(addr);
    }
    view.scheduleId = view.schedule ? evmAddressToEntityId(view.schedule) : null;
    const FINAL: Record<string, PaymentView["status"]> = { Executed: "EXECUTED", Vetoed: "VETOED", Cancelled: "CANCELLED", Expired: "EXPIRED" };
    const last = [...this.events].reverse().find((e) => FINAL[e.name] && Number(e.args.id) === id);
    if (last && view.status === "PENDING") view.status = FINAL[last.name];
    if (!view.confirmed && this.events.some((e) => e.name === "Confirmed" && Number(e.args.id) === id)) view.confirmed = true;
    const now = Math.floor(Date.now() / 1000);
    if (view.status === "PENDING" && this.stateCache && (now > view.expiresAt || view.epoch !== this.stateCache.epoch)) view.status = "EXPIRED";
    this.payments.set(id, view);
    this.emit("payment", view);
    return view;
  }

  async refreshChange(id: number): Promise<ChangeView> {
    const c = await this.vault.read.getChange(id);
    const kind = Number(c.kind) as ChangeKind;
    let fields: Record<string, string> = {};
    try {
      fields = stringifyFields(decodeChangeData(kind, c.data) as unknown as Record<string, unknown>);
    } catch {
      fields = { data: c.data };
    }
    const status = STATUS_NAMES[Number(c.status)];
    const view: ChangeView = {
      id,
      kind: CHANGE_KIND_NAMES[kind],
      fields,
      readyAt: Number(c.readyAt),
      expiresAt: Number(c.expiresAt),
      proposer: getAddress(c.proposer),
      approver: c.approver === "0x0000000000000000000000000000000000000000" ? null : getAddress(c.approver),
      keyEpoch: Number(c.keyEpoch),
      status: status === "NONE" ? "PENDING" : status,
      needsApproval: kind !== ChangeKind.REMOVE_PAYEE && kind !== ChangeKind.REMOVE_WATCHER && kind !== ChangeKind.REMOVE_GUARDIAN,
    };
    if (view.status === "PENDING" && this.events.some((e) => e.name === "ChangeExecuted" && Number(e.args.id) === id)) view.status = "EXECUTED";
    const now = Math.floor(Date.now() / 1000);
    if (view.status === "PENDING" && this.stateCache && (now > view.expiresAt || view.keyEpoch !== this.stateCache.keyEpoch)) view.status = "EXPIRED";
    this.changes.set(id, view);
    this.emit("change", view);
    return view;
  }

  rawChange(id: number): { kind: number; data: string } | null {
    const e = this.events.find((x) => x.name === "ChangeProposed" && Number(x.args.id) === id);
    return e ? { kind: Number(e.args.kind), data: String(e.args.data) } : null;
  }

  private async readImmutables(): Promise<Immutables> {
    if (this.immutables) return this.immutables;
    const r = this.vault.read;
    const [minCoolOff, settingsDelay, recoveryDelay, approvalWindow, freezeMax, probation, maxPending, maxDeadline] = await Promise.all([
      r.MIN_COOLOFF(),
      r.SETTINGS_DELAY(),
      r.RECOVERY_DELAY(),
      r.APPROVAL_WINDOW(),
      r.FREEZE_MAX(),
      r.PROBATION(),
      r.MAX_PENDING(),
      r.MAX_DEADLINE(),
    ]);
    this.immutables = {
      minCoolOff: Number(minCoolOff),
      settingsDelay: Number(settingsDelay),
      recoveryDelay: Number(recoveryDelay),
      approvalWindow: Number(approvalWindow),
      freezeMax: Number(freezeMax),
      probation: Number(probation),
      maxPending: Number(maxPending),
      maxDeadline: Number(maxDeadline),
    };
    return this.immutables;
  }

  /** The vault's post-quantum settings. A vault deployed before the PQ layer reports classical-only mode. */
  private async readPq(): Promise<PqView> {
    const r = this.vault.read;
    try {
      const [root, height, used] = await Promise.all([r.pqRoot(), r.PQ_HEIGHT(), r.pqUsed()]);
      const zero = /^0x0+$/.test(String(root));
      return { root: zero ? null : String(root), height: Number(height), used: Number(used), capacity: 2 ** Number(height) };
    } catch {
      return { root: null, height: 0, used: 0, capacity: 0 };
    }
  }

  async refreshState(force = false): Promise<StateView | null> {
    if (!force && this.stateCache && Date.now() - this.stateAt < 15_000) return this.state;
    const r = this.vault.read;
    const usdc = new Contract(this.cfg.usdc, ERC20, this.vault.provider);
    const lim = async (token: string): Promise<LimitsView> => {
      const l = await r.limits(token);
      return { instantMax: str(l.instantMax), waitMax: str(l.waitMax), dailyCap: str(l.dailyCap), agentDailyMax: str(l.agentDailyMax) };
    };
    const [immutables, hbarWei, usdcBal, gasReserve, hbarLim, usdcLim, coolOff, frozenUntil, frozen, epoch, keyEpoch, payees, pending, pq] =
      await Promise.all([
        this.readImmutables(),
        this.vault.provider.getBalance(this.cfg.vault),
        usdc.balanceOf(this.cfg.vault).catch(() => 0n),
        r.GAS_RESERVE(),
        lim(HBAR),
        lim(this.cfg.usdc),
        r.coolOff(),
        r.frozenUntil(),
        r.isFrozen(),
        r.epoch(),
        r.keyEpoch(),
        r.getPayees(),
        r.getPendingIds(),
        this.readPq(),
      ]);
    const payeeViews = await Promise.all(
      [...payees].map(async (a: string) => ({ address: getAddress(a), label: this.label(a), since: await this.since(a) })),
    );
    this.stateCache = {
      vault: this.cfg.vault,
      vaultId: this.cfg.vaultId,
      topicId: this.cfg.topicId,
      chainId: this.cfg.chainId,
      // One source of truth for HBAR units: the shared TINYBAR_TO_WEIBAR. hbarScale only applies in local mode.
      balances: { hbar: (hbarWei / (this.cfg.mode === "local" ? this.cfg.hbarScale : TINYBAR_TO_WEIBAR)).toString(), usdc: str(usdcBal) },
      usdc: this.cfg.usdc,
      pq,
      gasReserve: str(gasReserve),
      limits: { hbar: hbarLim, usdc: usdcLim },
      coolOff: Number(coolOff),
      frozenUntil: Number(frozenUntil),
      frozen: Boolean(frozen),
      epoch: Number(epoch),
      keyEpoch: Number(keyEpoch),
      puck: this.roles.puck,
      guardians: this.roles.guardians,
      watchers: this.roles.watchers,
      agent: this.roles.agent,
      payees: payeeViews,
      devices: [],
      immutables,
      pendingCount: [...pending].length,
    };
    this.stateAt = Date.now();
    const s = this.state!;
    this.emit("state", s);
    return s;
  }

  eventEntry(e: ChainEvent): TimelineEntry {
    return {
      kind: "event",
      name: e.name,
      at: e.timestamp,
      consensusTimestamp: e.consensusTimestamp,
      tx: e.txHash,
      link: hashscanTx(e.txHash),
      verified: true,
    };
  }

  eventsForPayment(id: number): TimelineEntry[] {
    return this.events.filter((e) => PAYMENT_EVENTS.has(e.name) && Number(e.args.id) === id).map((e) => this.eventEntry(e));
  }

  eventsForChange(id: number): TimelineEntry[] {
    return this.events.filter((e) => CHANGE_EVENTS.has(e.name) && Number(e.args.id) === id).map((e) => this.eventEntry(e));
  }
}
