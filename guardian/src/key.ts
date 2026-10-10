import { Wallet } from "ethers";

const KEY = "hisn.guardian.key";

export function loadOrCreateKey(): Wallet {
  const saved = localStorage.getItem(KEY);
  if (saved) {
    try {
      return new Wallet(saved);
    } catch {
      localStorage.removeItem(KEY);
    }
  }
  const w = Wallet.createRandom();
  localStorage.setItem(KEY, w.privateKey);
  return new Wallet(w.privateKey);
}

export function importKey(text: string): Wallet {
  const raw = text.trim();
  const w = new Wallet(/^0x/i.test(raw) ? raw : `0x${raw}`);
  localStorage.setItem(KEY, w.privateKey);
  return w;
}
