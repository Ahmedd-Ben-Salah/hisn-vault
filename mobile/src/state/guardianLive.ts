import { Signature, Wallet, getBytes } from "ethers";
import { approveDigest, freezeDigest, vetoDigest, type DigestContext } from "../core/shared";

/**
 * A guardian's actions against a real relayer. The key lives in this phone's secure storage; the relayer only
 * forwards the signed message, and the vault checks the signature itself.
 */
export function guardianLive(base: string, token: string, wallet: Wallet, ctx: DigestContext) {
  async function relay(path: string, digest: string, body: Record<string, unknown>): Promise<string> {
    const sig = await wallet.signMessage(getBytes(digest));
    const s = Signature.from(sig);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...body, r: s.r, s: s.s, sig }),
      });
      const text = await res.text();
      if (!res.ok) {
        let why = text;
        try {
          why = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          void 0;
        }
        throw new Error(why || `relayer ${res.status}`);
      }
      return ((JSON.parse(text) as { tx?: string }).tx ?? "") as string;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    stop: (paymentId: number) => relay("/relay/veto", vetoDigest(ctx, BigInt(paymentId)), { paymentId }),
    approve: (paymentId: number) => relay("/relay/approve", approveDigest(ctx, BigInt(paymentId)), { paymentId }),
    freeze: (epoch: number) => relay("/relay/freeze", freezeDigest(ctx, BigInt(epoch)), { epoch }),
  };
}
