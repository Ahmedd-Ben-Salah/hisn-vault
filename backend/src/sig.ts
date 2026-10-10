import { Signature } from "ethers";
import { completeSignature } from "./shared.js";

export interface SigInput {
  r?: string;
  s?: string;
  sig?: string;
}

export interface Finished {
  sig: string;
  signer: string;
}

function split(input: SigInput): { r: string; s: string } | null {
  if (input.sig && input.sig !== "0x") {
    try {
      const p = Signature.from(input.sig);
      return { r: p.r, s: p.s };
    } catch {
      return null;
    }
  }
  if (input.r && input.s) return { r: input.r, s: input.s };
  return null;
}

export function finishSignature(digest: string, input: SigInput, candidates: string[]): Finished | null {
  const rs = split(input);
  if (!rs) return null;
  for (const c of candidates) {
    try {
      const sig = completeSignature(digest, rs.r, rs.s, c);
      if (sig) return { sig, signer: c };
    } catch {
      continue;
    }
  }
  return null;
}
