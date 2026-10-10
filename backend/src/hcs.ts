import { Client, PrivateKey, AccountId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import {
  type HcsMessage,
  type HcsType,
  type TimelineEntry,
  type DigestContext,
  ChangeKind,
  SIGNED_TYPES,
  decodeHcs,
  encodeHcs,
  payDigest,
  vetoDigest,
  approveDigest,
  alertAckDigest,
  reconfirmDigest,
  freezeDigest,
  cancelDigest,
  changeDigest,
  changeApproveDigest,
  changeVetoDigest,
  decodeChangeData,
  recoverSigner,
  hashscanTx,
  hashscanTopic,
} from "./shared.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";

export interface Roles {
  puck: string;
  guardians: string[];
  watchers: string[];
  agent: string | null;
}

export interface Stored {
  seq: number;
  consensus: string;
  msg: HcsMessage;
}

export type Draft = Omit<HcsMessage, "v" | "vault" | "at"> & { at?: number };

const PAYMENT_TYPES: ReadonlySet<HcsType> = new Set<HcsType>([
  "REQUEST",
  "PAY_SIGNED",
  "PROPOSED",
  "ALERT_ACK",
  "VETO_SIGNED",
  "VETOED",
  "APPROVE_SIGNED",
  "APPROVED",
  "RECONFIRM_SIGNED",
  "CONFIRMED",
  "CANCELLED",
  "RELEASED",
  "SCHEDULE_FAILED",
]);

function big(v: unknown): bigint {
  return BigInt(String(v));
}

function lower(xs: (string | null)[]): string[] {
  return xs.filter((x): x is string => !!x).map((x) => x.toLowerCase());
}

export class HcsLog {
  private client: Client | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private verifyCache = new Map<number, string | null>();
  private listeners = new Set<(e: TimelineEntry) => void>();
  private ctx: DigestContext;

  constructor(
    private cfg: Config,
    private db: Db,
    private roles: () => Roles,
    private knownTx: (hash: string) => boolean,
  ) {
    this.ctx = { chainId: cfg.chainId, vault: cfg.vault };
    if (cfg.mode === "testnet" && cfg.topicId && cfg.relayerAccountId) {
      this.client = Client.forTestnet();
      this.client.setOperator(
        AccountId.fromString(cfg.relayerAccountId),
        PrivateKey.fromStringECDSA(cfg.relayerKey.replace(/^0x/, "")),
      );
    }
  }

  get enabled(): boolean {
    return this.cfg.mode === "local" || this.client !== null;
  }

  onEntry(fn: (e: TimelineEntry) => void): void {
    this.listeners.add(fn);
  }

  publish(key: string, draft: Draft): void {
    if (!this.enabled || this.db.posted(key)) return;
    this.db.markPosted(key);
    const msg: HcsMessage = { v: 1, vault: this.cfg.vault, at: draft.at ?? Math.floor(Date.now() / 1000), ...draft } as HcsMessage;
    let raw: string;
    try {
      raw = encodeHcs(msg);
    } catch (e) {
      console.error(`hcs ${draft.type} too large`, e);
      return;
    }
    if (this.cfg.mode === "local") {
      const now = Date.now();
      const consensus = `${Math.floor(now / 1000)}.${String((now % 1000) * 1_000_000).padStart(9, "0")}`;
      const seq = this.db.addHcs(null, consensus, raw);
      this.announce({ seq, consensus, msg });
      return;
    }
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const tx = await new TopicMessageSubmitTransaction().setTopicId(this.cfg.topicId!).setMessage(raw).execute(this.client!);
          await tx.getReceipt(this.client!);
          return;
        } catch (e) {
          if (attempt === 2) console.error(`hcs submit ${draft.type} failed`, (e as Error).message);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    };
    this.queue = this.queue.then(run, run);
  }

  async poll(): Promise<void> {
    if (this.cfg.mode !== "testnet" || !this.cfg.topicId) return;
    let last = this.db.lastHcsSeq();
    let url: string | null = `${this.cfg.mirrorUrl}/api/v1/topics/${this.cfg.topicId}/messages?order=asc&limit=100&sequencenumber=gte:${last + 1}`;
    let pages = 0;
    while (url && pages < 10) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`mirror topic ${r.status}`);
      const body = (await r.json()) as {
        messages: { sequence_number: number; consensus_timestamp: string; message: string }[];
        links?: { next?: string | null };
      };
      for (const m of body.messages) {
        if (m.sequence_number <= last) continue;
        last = m.sequence_number;
        const raw = Buffer.from(m.message, "base64").toString("utf8");
        this.db.addHcs(m.sequence_number, m.consensus_timestamp, raw);
        const msg = decodeHcs(raw);
        if (msg) this.announce({ seq: m.sequence_number, consensus: m.consensus_timestamp, msg });
      }
      url = body.links?.next ? `${this.cfg.mirrorUrl}${body.links.next}` : null;
      pages++;
    }
  }

  private announce(s: Stored): void {
    if (s.msg.vault.toLowerCase() !== this.cfg.vault.toLowerCase()) return;
    const e = this.toEntry(s);
    for (const l of this.listeners) l(e);
  }

  all(limit: number): TimelineEntry[] {
    return this.db
      .listHcs(limit * 2)
      .map((row) => ({ seq: row.seq, consensus: row.consensus, msg: decodeHcs(row.raw) }))
      .filter((s): s is Stored => !!s.msg && s.msg.vault.toLowerCase() === this.cfg.vault.toLowerCase())
      .slice(0, limit)
      .map((s) => this.toEntry(s));
  }

  forPayment(id: number): TimelineEntry[] {
    return this.db
      .hcsByRef(id)
      .map((row) => ({ seq: row.seq, consensus: row.consensus, msg: decodeHcs(row.raw) }))
      .filter((s): s is Stored => !!s.msg && PAYMENT_TYPES.has(s.msg.type) && s.msg.vault.toLowerCase() === this.cfg.vault.toLowerCase())
      .map((s) => this.toEntry(s));
  }

  forChange(id: number): TimelineEntry[] {
    return this.db
      .hcsByRef(id)
      .map((row) => ({ seq: row.seq, consensus: row.consensus, msg: decodeHcs(row.raw) }))
      .filter((s): s is Stored => !!s.msg && s.msg.type.startsWith("CHANGE_") && s.msg.vault.toLowerCase() === this.cfg.vault.toLowerCase())
      .map((s) => this.toEntry(s));
  }

  toEntry(s: Stored): TimelineEntry {
    const signer = this.verifiedSigner(s);
    const backed = !!s.msg.tx && this.knownTx(s.msg.tx);
    const signed = SIGNED_TYPES.has(s.msg.type) || !!s.msg.sig;
    const verified = signed ? signer !== null : backed;
    return {
      kind: "hcs",
      name: s.msg.type,
      at: Math.floor(Number(s.consensus)),
      consensusTimestamp: s.consensus,
      tx: s.msg.tx,
      link: s.msg.tx ? hashscanTx(s.msg.tx) : this.cfg.topicId ? hashscanTopic(this.cfg.topicId) : undefined,
      verified,
      signer: signer ?? undefined,
      hcs: s.msg,
    };
  }

  private verifiedSigner(s: Stored): string | null {
    if (!s.msg.sig || !s.msg.signer) return null;
    if (this.verifyCache.has(s.seq)) return this.verifyCache.get(s.seq)!;
    let out: string | null = null;
    try {
      const d = this.digestFor(s.msg);
      if (d) {
        const who = recoverSigner(d.digest, s.msg.sig);
        if (who.toLowerCase() === s.msg.signer.toLowerCase() && lower(d.allowed).includes(who.toLowerCase())) out = who;
      }
    } catch {
      out = null;
    }
    this.verifyCache.set(s.seq, out);
    return out;
  }

  private digestFor(m: HcsMessage): { digest: string; allowed: (string | null)[] } | null {
    const r = this.roles();
    const b = m.body;
    const keepers = [...r.guardians, ...r.watchers];
    switch (m.type) {
      case "PAY_SIGNED":
        return {
          digest: payDigest(this.ctx, { to: String(b.to), token: String(b.token), amount: big(b.amount), nonce: big(b.nonce), deadline: big(b.deadline) }),
          allowed: [r.puck],
        };
      case "ALERT_ACK":
        return { digest: alertAckDigest(this.ctx, big(m.ref), big(b.nonce)), allowed: keepers };
      case "VETO_SIGNED":
        return { digest: vetoDigest(this.ctx, big(m.ref)), allowed: keepers };
      case "APPROVE_SIGNED":
        return { digest: approveDigest(this.ctx, big(m.ref)), allowed: r.guardians };
      case "RECONFIRM_SIGNED":
        return { digest: reconfirmDigest(this.ctx, big(m.ref), big(b.nonce), big(b.deadline)), allowed: [r.puck] };
      case "CANCELLED":
        return { digest: cancelDigest(this.ctx, big(m.ref)), allowed: [r.puck] };
      case "FROZEN":
        return { digest: freezeDigest(this.ctx, big(b.epoch)), allowed: [r.puck, ...keepers] };
      case "CHANGE_SIGNED": {
        const kind = Number(b.kind) as ChangeKind;
        return {
          digest: changeDigest(this.ctx, decodeChangeData(kind, String(b.data)), big(b.keyEpoch), big(b.nonce), big(b.deadline)),
          allowed: [r.puck, ...r.guardians],
        };
      }
      case "CHANGE_APPROVED":
        return { digest: changeApproveDigest(this.ctx, big(m.ref), Number(b.kind) as ChangeKind, String(b.data)), allowed: r.guardians };
      case "CHANGE_VETOED":
        return { digest: changeVetoDigest(this.ctx, big(m.ref)), allowed: [r.puck, ...keepers] };
      default:
        return null;
    }
  }

  close(): void {
    this.client?.close();
  }
}
