import { JsonRpcProvider, type JsonRpcPayload, type JsonRpcResult } from "ethers";

const NO_RETRY = new Set(["eth_sendRawTransaction"]);

function transient(e: unknown): boolean {
  const x = e as { code?: string; info?: { responseStatus?: string }; message?: string };
  if (x?.code === "SERVER_ERROR" || x?.code === "TIMEOUT" || x?.code === "NETWORK_ERROR") return true;
  const m = `${x?.info?.responseStatus ?? ""} ${x?.message ?? ""}`;
  return /\b(429|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(m);
}

export class RetryProvider extends JsonRpcProvider {
  async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const methods = (Array.isArray(payload) ? payload : [payload]).map((p) => p.method);
    const retry = !methods.some((m) => NO_RETRY.has(m));
    let last: unknown;
    for (let attempt = 0; attempt < (retry ? 4 : 1); attempt++) {
      try {
        return await super._send(payload);
      } catch (e) {
        last = e;
        if (!transient(e)) throw e;
        await new Promise((r) => setTimeout(r, 700 * 2 ** attempt));
      }
    }
    throw last;
  }
}
