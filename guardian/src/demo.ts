import { ChangeKind, USDC_TESTNET, encodeChangeData, type ChangeFields } from "@hisn/shared";
import { ROLE, STATUS, TIER, type Actions, type Chg, type Done, type Pay, type View } from "./model";

const STRANGER = "0x8d1fe0c4b2a39e7d6c5b4a3f2e1d0c9b8a7f6e51";
const NEW_PUCK = "0x4f9e2d7c1b8a6e3d5c0f9b2a7e4d1c8b5a3f6e29";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function fakeTx(): string {
  return `0.0.0@${now()}.000000000 (demo)`;
}

export class Demo {
  private v: View;
  private listeners = new Set<() => void>();
  private nextId = 7n;

  constructor() {
    const t = now();
    this.v = {
      mode: "demo",
      pending: [this.payment(TIER.WAIT, 100_000_000n, t - 8)],
      changes: [],
      epoch: 3,
      keyEpoch: 5,
      frozenUntil: 0,
      lastFreezer: "0x0000000000000000000000000000000000000000",
      myRole: ROLE.GUARDIAN,
      checkedAt: t,
      error: null,
    };
  }

  private payment(tier: number, amount: bigint, at: number): Pay {
    return {
      id: this.nextId++,
      to: STRANGER,
      token: USDC_TESTNET,
      amount,
      proposedAt: at,
      confirmFrom: tier === TIER.WAIT ? at + 30 : at,
      releaseAt: at + 60,
      expiresAt: at + 60 + 1800,
      epoch: 3,
      tier,
      status: STATUS.PENDING,
      confirmed: false,
      isPayee: false,
    };
  }

  view = (): View => this.v;

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<View>): void {
    this.v = { ...this.v, ...patch, checkedAt: now() };
    for (const l of this.listeners) l();
  }

  addLarge(): void {
    this.set({ pending: [...this.v.pending, this.payment(TIER.APPROVAL, 800_000_000n, now())] });
  }

  addRecovery(): void {
    const fields: ChangeFields = { kind: ChangeKind.RECOVER_PUCK, address: NEW_PUCK };
    const c: Chg = {
      id: 3n,
      kind: ChangeKind.RECOVER_PUCK,
      data: encodeChangeData(fields),
      proposedAt: now(),
      readyAt: now() + 600,
      expiresAt: now() + 2400,
      proposer: "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c02",
      approver: "0x0000000000000000000000000000000000000000",
      keyEpoch: this.v.keyEpoch,
      status: STATUS.PENDING,
      fields,
    };
    this.set({ changes: [...this.v.changes.filter((x) => x.id !== c.id), c] });
  }

  tick(): void {
    const t = now();
    this.set({
      pending: this.v.pending.filter((p) => !(p.confirmed && t >= p.releaseAt) && t <= p.expiresAt),
    });
  }

  actions(): Actions {
    const ok = async (): Promise<Done> => {
      await new Promise((r) => setTimeout(r, 600));
      return { path: "demo", tx: fakeTx() };
    };
    return {
      stop: async (p) => {
        const d = await ok();
        this.set({ pending: this.v.pending.filter((x) => x.id !== p.id) });
        return d;
      },
      approve: async (p) => {
        const d = await ok();
        this.set({ pending: this.v.pending.map((x) => (x.id === p.id ? { ...x, confirmed: true } : x)) });
        return d;
      },
      freeze: async () => {
        const d = await ok();
        this.set({ frozenUntil: now() + 600, epoch: this.v.epoch + 1, keyEpoch: this.v.keyEpoch + 1, pending: [], changes: [], lastFreezer: "me" });
        return d;
      },
      renewFreeze: async () => {
        const d = await ok();
        this.set({ frozenUntil: now() + 600 });
        return d;
      },
      approveChange: async (c) => {
        const d = await ok();
        this.set({ changes: this.v.changes.map((x) => (x.id === c.id ? { ...x, approver: "me" } : x)) });
        return d;
      },
      stopChange: async (c) => {
        const d = await ok();
        this.set({ changes: this.v.changes.filter((x) => x.id !== c.id) });
        return d;
      },
    };
  }
}
