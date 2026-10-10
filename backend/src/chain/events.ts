import { JsonRpcProvider, LogDescription } from "ethers";
import { vaultInterface } from "./vault.js";

export interface ChainEvent {
  key: string;
  name: string;
  args: Record<string, string | number | boolean>;
  txHash: string;
  timestamp: number;
  consensusTimestamp?: string;
  blockNumber: number;
  logIndex: number;
}

export interface EventSource {
  poll(): Promise<ChainEvent[]>;
  cursor(): string;
  restore(c: string): void;
}

function flatten(d: LogDescription): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  d.fragment.inputs.forEach((inp, i) => {
    const v = d.args[i];
    if (typeof v === "bigint") out[inp.name] = v.toString();
    else if (typeof v === "boolean" || typeof v === "number") out[inp.name] = v;
    else out[inp.name] = String(v);
  });
  return out;
}

function decode(topics: string[], data: string): LogDescription | null {
  try {
    return vaultInterface.parseLog({ topics, data });
  } catch {
    return null;
  }
}

interface MirrorLog {
  address: string;
  data: string;
  topics: string[];
  timestamp: string;
  transaction_hash: string;
  index: number;
  block_number: number;
}

export class MirrorEventSource implements EventSource {
  private last = "0";

  constructor(private mirrorUrl: string, private vault: string) {}

  cursor(): string {
    return this.last;
  }

  restore(c: string): void {
    this.last = c;
  }

  async poll(): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    let url: string | null = `${this.mirrorUrl}/api/v1/contracts/${this.vault}/results/logs?order=asc&limit=100&timestamp=gt:${this.last}`;
    let pages = 0;
    while (url && pages < 10) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`mirror logs ${r.status}`);
      const body = (await r.json()) as { logs: MirrorLog[]; links?: { next?: string | null } };
      for (const l of body.logs) {
        const d = decode(l.topics, l.data);
        this.last = l.timestamp;
        if (!d) continue;
        out.push({
          key: `${l.transaction_hash}:${l.index}`,
          name: d.name,
          args: flatten(d),
          txHash: l.transaction_hash,
          timestamp: Math.floor(Number(l.timestamp)),
          consensusTimestamp: l.timestamp,
          blockNumber: l.block_number,
          logIndex: l.index,
        });
      }
      url = body.links?.next ? `${this.mirrorUrl}${body.links.next}` : null;
      pages++;
    }
    return out;
  }
}

export class RpcEventSource implements EventSource {
  private last = -1;
  private times = new Map<number, number>();

  constructor(private provider: JsonRpcProvider, private vault: string) {}

  cursor(): string {
    return String(this.last);
  }

  restore(c: string): void {
    this.last = Number(c);
  }

  async poll(): Promise<ChainEvent[]> {
    const head = await this.provider.getBlockNumber();
    if (head <= this.last) return [];
    const logs = await this.provider.getLogs({ address: this.vault, fromBlock: this.last + 1, toBlock: head });
    const out: ChainEvent[] = [];
    for (const l of logs) {
      const d = decode([...l.topics], l.data);
      if (!d) continue;
      let ts = this.times.get(l.blockNumber);
      if (ts === undefined) {
        const b = await this.provider.getBlock(l.blockNumber);
        ts = b ? b.timestamp : 0;
        this.times.set(l.blockNumber, ts);
      }
      out.push({
        key: `${l.transactionHash}:${l.index}`,
        name: d.name,
        args: flatten(d),
        txHash: l.transactionHash,
        timestamp: ts,
        blockNumber: l.blockNumber,
        logIndex: l.index,
      });
    }
    this.last = head;
    return out;
  }
}
