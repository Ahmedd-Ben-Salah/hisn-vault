import type {
  ChangeView,
  LiveEvent,
  PaymentView,
  RequestView,
  StateView,
  TimelineEntry,
} from "@hisn/shared";
import { registerUsdc } from "../lib/format";
import type { AgentReply, AgentTurn, ChangeRequestView, Connection, HisnSource, SimControls, Snapshot, TierName } from "./types";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function upsert<T>(list: T[], item: T, key: (x: T) => number): T[] {
  const k = key(item);
  const i = list.findIndex((x) => key(x) === k);
  if (i === -1) return [item, ...list];
  const next = [...list];
  next[i] = item;
  return next;
}

export class LiveSource implements HisnSource {
  readonly kind = "live" as const;
  private listeners = new Set<() => void>();
  private snap: Snapshot | null = null;
  private ws: WebSocket | null = null;
  private retry = 1000;
  private clock: ReturnType<typeof setInterval> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private historyLoaded = false;
  private autoPuck = false;
  readonly sim?: SimControls;

  constructor(
    private readonly base: string,
    private readonly token: string,
    simUrl = "",
  ) {
    if (simUrl) this.sim = this.devices(simUrl.replace(/\/$/, ""));
  }

  private devices(url: string): SimControls {
    const self = this;
    const hit = (path: string) => {
      void fetch(`${url}${path}`, { method: "POST" })
        .catch(() => undefined)
        .finally(() => setTimeout(() => void self.load(), 800));
    };
    return {
      kind: "devices",
      get autoPuck() {
        return self.autoPuck;
      },
      setAutoPuck: (on) => {
        self.autoPuck = on;
        hit(`/auto?on=${on ? 1 : 0}`);
        self.emit({});
      },
      get serverOn() {
        return self.getSnapshot().connection === "live";
      },
      puckSign: (rid) => hit(`/puck/sign/${rid}`),
      puckReject: (rid) => hit(`/puck/reject/${rid}`),
      puckSignChange: (rid) => hit(`/puck/change/${rid}`),
      puckReconfirm: (pid) => hit(`/puck/reconfirm/${pid}`),
      puckCancel: (pid) => hit(`/puck/cancel/${pid}`),
      guardianStop: (pid, who) => hit(`/guardian/stop/${pid}?who=${who}`),
      guardianApprove: (pid) => hit(`/guardian/approve/${pid}`),
      freeze: (who) => hit(`/freeze?who=${who}`),
      proposeChange: (kind, fields) => void self.requestChange(kind, fields).catch(() => undefined),
      approveChange: (cid) => hit(`/change/approve/${cid}`),
      vetoChange: (cid) => hit(`/change/veto/${cid}`),
    };
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        msg = body.error ?? body.message ?? msg;
      } catch {
        void 0;
      }
      throw new Error(msg);
    }
    return (await res.json()) as T;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.started) this.start();
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): Snapshot {
    return this.snap ?? EMPTY;
  }

  private emit(patch: Partial<Snapshot>): void {
    const base = this.snap ?? EMPTY;
    this.snap = { ...base, ...patch, now: nowSec() };
    for (const l of this.listeners) l();
  }

  private start(): void {
    this.started = true;
    this.emit({ connection: "connecting" });
    void this.load();
    this.connect();
    this.clock = setInterval(() => this.emit({}), 1000);
    this.poll = setInterval(() => {
      if (this.snap?.connection !== "live") void this.load();
    }, 5000);
  }

  stop(): void {
    this.ws?.close();
    if (this.clock) clearInterval(this.clock);
    if (this.poll) clearInterval(this.poll);
  }

  private async load(): Promise<void> {
    try {
      const [state, payments, changes, log, requests] = await Promise.all([
        this.api<StateView>("/state"),
        this.api<PaymentView[]>("/payments"),
        this.api<ChangeView[]>("/changes").catch(() => this.snap?.changes ?? []),
        this.api<TimelineEntry[]>("/log?limit=200").catch(() => this.snap?.log ?? []),
        this.api<RequestView[]>("/requests").catch(() => this.snap?.requests ?? []),
      ]);
      registerUsdc((state as { usdc?: string }).usdc);
      this.emit({ state, payments: sortPayments(payments), changes, log, requests });
      if (!this.historyLoaded) {
        this.historyLoaded = true;
        const history = await this.api<AgentTurn[]>("/agent/history").catch(() => []);
        if (Array.isArray(history) && history.length > 0 && this.getSnapshot().agent.length === 0) this.emit({ agent: history });
      }
    } catch {
      if (this.snap?.connection !== "live") this.emit({ connection: "offline" });
    }
  }

  private connect(): void {
    const url = `${this.base.replace(/^http/, "ws")}/live?token=${encodeURIComponent(this.token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.later();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
      this.emit({ connection: "live" });
      void this.load();
    };
    ws.onmessage = (ev) => {
      try {
        this.apply(JSON.parse(String(ev.data)) as LiveEvent);
      } catch {
        void 0;
      }
    };
    ws.onclose = () => {
      this.emit({ connection: "offline" });
      this.later();
    };
  }

  private later(): void {
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 15000);
  }

  private apply(e: LiveEvent): void {
    const s = this.getSnapshot();
    switch (e.kind) {
      case "payment":
        this.emit({ payments: sortPayments(upsert(s.payments, e.data, (p) => p.id)) });
        break;
      case "change":
        this.emit({ changes: upsert(s.changes, e.data, (c) => c.id) });
        break;
      case "state":
        this.emit({ state: e.data });
        break;
      case "device":
        this.emit({
          state: {
            ...s.state,
            devices: s.state.devices.some((d) => d.id === e.data.id)
              ? s.state.devices.map((d) => (d.id === e.data.id ? e.data : d))
              : [...s.state.devices, e.data],
          },
        });
        break;
      case "hcs":
        this.emit({ log: [e.data, ...s.log].slice(0, 500) });
        break;
      case "request":
        this.emit({ requests: upsert(s.requests, e.data, (r) => r.reqId) });
        break;
    }
  }

  async timeline(paymentId: number): Promise<TimelineEntry[]> {
    return this.api<TimelineEntry[]>(`/payments/${paymentId}/timeline`);
  }

  async requestPayment(to: string, token: string, amount: string): Promise<RequestView> {
    const { reqId } = await this.api<{ reqId: number }>("/requests", {
      method: "POST",
      body: JSON.stringify({ to, token, amount, source: "dashboard" }),
    });
    const r: RequestView = { reqId, to, token, amount, source: "dashboard", status: "waiting_puck" };
    this.emit({ requests: upsert(this.getSnapshot().requests, r, (x) => x.reqId) });
    void this.follow(reqId);
    return r;
  }

  async previewTier(to: string, token: string, amount: string): Promise<TierName> {
    const { tier } = await this.api<{ tier: string | number }>("/tier", { method: "POST", body: JSON.stringify({ to, token, amount }) });
    const names: TierName[] = ["INSTANT", "WAIT", "APPROVAL"];
    return typeof tier === "number" ? names[tier] : (String(tier).toUpperCase() as TierName);
  }

  async previewReasons(to: string, token: string, amount: string): Promise<string[]> {
    const { reasons } = await this.api<{ tier: string | number; reasons?: string[] }>("/tier", { method: "POST", body: JSON.stringify({ to, token, amount }) });
    return Array.isArray(reasons) ? reasons : [];
  }

  async requestStop(paymentId: number): Promise<void> {
    await this.api(`/payments/${paymentId}/stop-request`, { method: "POST", body: "{}" });
  }

  async requestFreeze(): Promise<void> {
    await this.api("/freeze-request", { method: "POST", body: "{}" });
  }

  async requestChange(kind: ChangeView["kind"], fields: Record<string, string>): Promise<ChangeRequestView> {
    const c = await this.api<ChangeRequestView>("/changes/request", { method: "POST", body: JSON.stringify({ kind, fields }) });
    this.emit({ changeRequests: upsert(this.getSnapshot().changeRequests, c, (x) => x.reqId) });
    void this.followChange(c.reqId);
    return c;
  }

  private async followChange(reqId: number): Promise<void> {
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const c = await this.api<ChangeRequestView>(`/changes/request/${reqId}`);
        this.emit({ changeRequests: upsert(this.getSnapshot().changeRequests, c, (x) => x.reqId) });
        if (c.status !== "waiting_puck") {
          void this.load();
          return;
        }
      } catch {
        void 0;
      }
    }
  }

  private async follow(reqId: number): Promise<void> {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await this.api<RequestView>(`/requests/${reqId}`);
        this.emit({ requests: upsert(this.getSnapshot().requests, r, (x) => x.reqId) });
        if (r.status !== "waiting_puck") return;
      } catch {
        void 0;
      }
    }
  }

  async agentChat(message: string): Promise<AgentReply> {
    const s = this.getSnapshot();
    const mine: AgentTurn = { role: "owner", text: message, at: nowSec(), actions: [] };
    this.emit({ agent: [...s.agent, mine] });
    const reply = await this.api<AgentReply>("/agent/chat", { method: "POST", body: JSON.stringify({ message }) });
    this.emit({ agent: [...this.getSnapshot().agent, { role: "agent", text: reply.reply, at: nowSec(), actions: reply.actions }] });
    return reply;
  }

  async executeByHand(paymentId: number): Promise<string> {
    const { tx } = await this.api<{ tx: string }>(`/fallback/execute/${paymentId}`, { method: "POST" });
    return tx;
  }

  async applyChange(changeId: number): Promise<string> {
    const { tx } = await this.api<{ tx: string }>(`/relay/change/${changeId}/execute`, { method: "POST" });
    return tx;
  }

  async exportEvidence(paymentId: number): Promise<unknown> {
    return this.api<unknown>(`/export/${paymentId}`);
  }
}

function sortPayments(p: PaymentView[]): PaymentView[] {
  return [...p].sort((a, b) => b.proposedAt - a.proposedAt);
}

const EMPTY_LIMITS = { instantMax: "0", waitMax: "0", dailyCap: "0", agentDailyMax: "0" };

const EMPTY: Snapshot = {
  state: {
    vault: "",
    vaultId: null,
    topicId: null,
    chainId: 296,
    balances: { hbar: "0", usdc: "0" },
    gasReserve: "0",
    limits: { hbar: EMPTY_LIMITS, usdc: EMPTY_LIMITS },
    coolOff: 0,
    frozenUntil: 0,
    frozen: false,
    epoch: 0,
    keyEpoch: 0,
    puck: "",
    guardians: [],
    watchers: [],
    agent: null,
    payees: [],
    devices: [],
    immutables: {
      minCoolOff: 0,
      settingsDelay: 0,
      recoveryDelay: 0,
      approvalWindow: 0,
      freezeMax: 0,
      probation: 0,
      maxPending: 0,
      maxDeadline: 0,
    },
    pendingCount: 0,
  },
  payments: [],
  changes: [],
  requests: [],
  changeRequests: [],
  log: [],
  agent: [],
  connection: "connecting" as Connection,
  now: nowSec(),
};
