import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Wallet } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform } from "react-native";
import { LiveSource } from "../core/data/live";
import { MockSource } from "../core/data/mock";
import type { HisnSource, Snapshot } from "../core/data/types";
import { DEMO_USDC, HBAR, USDC_TESTNET } from "../core/shared";
import { useNames } from "../core/lib/people";
import { ACCOUNTS, accountById, type Account } from "./accounts";
import { guardianLive } from "./guardianLive";

export type Mode = "demo" | "live";

export interface Settings {
  mode: Mode;
  relayerUrl: string;
  relayerToken: string;
  /** Optional device simulator on the laptop (npm run sim:local), to play the puck in live mode. */
  simUrl: string;
}

const DEFAULTS: Settings = { mode: "demo", relayerUrl: "", relayerToken: "", simUrl: "" };
const SETTINGS_KEY = "hisn.settings.v1";
const ACCOUNT_KEY = "hisn.account.v1";
const keyName = (accountId: string) => `hisn_guardian_key_${accountId}`;

/** The phone's secure storage (Keychain / Keystore). In a web browser, where it does not exist, local storage. */
const secure = {
  get: (k: string): Promise<string | null> => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string): Promise<void> => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  remove: (k: string): Promise<void> => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};

/** The vault lists guardians by address; give them the names of the people on this phone. */
function GuardianNames({ source }: { source: HisnSource }) {
  const { names, setName } = useNames();
  const guardians = useSyncExternalStore(
    useCallback((l: () => void) => source.subscribe(l), [source]),
    () => source.getSnapshot().state.guardians.join(","),
  );
  useEffect(() => {
    const people = ACCOUNTS.filter((a) => a.role === "guardian");
    guardians
      .split(",")
      .filter(Boolean)
      .forEach((addr, i) => {
        if (people[i] && !names[addr.toLowerCase()]) setName(addr, people[i].name);
      });
  }, [guardians, names, setName]);
  return null;
}

interface Session {
  ready: boolean;
  settings: Settings;
  saveSettings(next: Settings): Promise<void>;
  account: Account | null;
  setAccount(id: string | null): void;
  source: HisnSource;
  /** Starts the demo again from the beginning. */
  resetDemo(): void;
  /** Guardian actions for the current account, in the current mode. */
  guardian: {
    stop(paymentId: number): Promise<void>;
    approve(paymentId: number): Promise<void>;
    freeze(): Promise<void>;
  };
  guardianKey: { address: string | null; create(): Promise<string>; importKey(text: string): Promise<string>; remove(): Promise<void> };
}

const Ctx = createContext<Session | null>(null);

function makeSource(s: Settings): HisnSource {
  if (s.mode === "live" && s.relayerUrl) return new LiveSource(s.relayerUrl.replace(/\/$/, ""), s.relayerToken, s.simUrl);
  return new MockSource(null);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<HisnSource>(() => new MockSource(null));
  // Guardian key address, remembered per account so switching accounts never shows another person's key.
  const [keyState, setKeyState] = useState<{ accountId: string; address: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);
        const saved = raw ? ({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } as Settings) : DEFAULTS;
        setSettings(saved);
        setSource(makeSource(saved));
        setAccountId(await AsyncStorage.getItem(ACCOUNT_KEY));
      } catch {
        // Storage unavailable: run the demo with defaults.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const account = accountById(accountId);
  const keyAddress = account && keyState?.accountId === account.id ? keyState.address : null;
  const setKeyAddress = useCallback((address: string | null) => {
    if (account) setKeyState({ accountId: account.id, address });
  }, [account]);

  useEffect(() => {
    if (!account || account.role !== "guardian") return;
    let alive = true;
    const id = account.id;
    secure.get(keyName(id))
      .then((pk) => alive && setKeyState({ accountId: id, address: pk ? new Wallet(pk).address : null }))
      .catch(() => alive && setKeyState({ accountId: id, address: null }));
    return () => {
      alive = false;
    };
  }, [account]);

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    setSource(makeSource(next));
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const setAccount = useCallback((id: string | null) => {
    setAccountId(id);
    if (id) void AsyncStorage.setItem(ACCOUNT_KEY, id).catch(() => undefined);
    else void AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => undefined);
  }, []);

  const resetDemo = useCallback(() => setSource(makeSource(settings)), [settings]);

  const guardian = useMemo<Session["guardian"]>(() => {
    if (source.kind === "mock") {
      return {
        stop: async (id) => source.sim?.guardianStop(id, "guardian"),
        approve: async (id) => source.sim?.guardianApprove(id),
        freeze: async () => source.sim?.freeze("guardian"),
      };
    }
    const live = async () => {
      if (!account) throw new Error("No account selected.");
      const pk = await secure.get(keyName(account.id));
      if (!pk) throw new Error("This phone has no guardian key yet. Add one in Settings.");
      const snap = source.getSnapshot();
      return { api: guardianLive(settings.relayerUrl.replace(/\/$/, ""), settings.relayerToken, new Wallet(pk), { chainId: snap.state.chainId, vault: snap.state.vault }), snap };
    };
    return {
      stop: async (id) => void (await (await live()).api.stop(id)),
      approve: async (id) => void (await (await live()).api.approve(id)),
      freeze: async () => {
        const { api, snap } = await live();
        await api.freeze(snap.state.epoch);
      },
    };
  }, [source, account, settings]);

  const guardianKey = useMemo<Session["guardianKey"]>(
    () => ({
      address: keyAddress,
      create: async () => {
        if (!account) throw new Error("No account selected.");
        const w = Wallet.createRandom();
        await secure.set(keyName(account.id), w.privateKey);
        setKeyAddress(w.address);
        return w.address;
      },
      importKey: async (text: string) => {
        if (!account) throw new Error("No account selected.");
        const pk = text.trim().startsWith("0x") ? text.trim() : `0x${text.trim()}`;
        const w = new Wallet(pk);
        await secure.set(keyName(account.id), w.privateKey);
        setKeyAddress(w.address);
        return w.address;
      },
      remove: async () => {
        if (!account) return;
        await secure.remove(keyName(account.id));
        setKeyAddress(null);
      },
    }),
    [account, keyAddress, setKeyAddress],
  );

  const value = useMemo<Session>(
    () => ({ ready, settings, saveSettings, account, setAccount, source, resetDemo, guardian, guardianKey }),
    [ready, settings, saveSettings, account, setAccount, source, resetDemo, guardian, guardianKey],
  );
  return (
    <Ctx.Provider value={value}>
      <GuardianNames source={source} />
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}

export function useSnapshot(): Snapshot {
  const { source } = useSession();
  return useSyncExternalStore(
    useCallback((l: () => void) => source.subscribe(l), [source]),
    () => source.getSnapshot(),
  );
}

/** The USDC token the vault uses (same rule as the dashboard). */
export function useUsdc(): string {
  const { source } = useSession();
  const { state, payments } = useSnapshot();
  const declared = (state as { usdc?: string }).usdc;
  if (declared) return declared;
  if (source.kind === "mock") return USDC_TESTNET;
  const seen = payments.map((p) => p.token).find((t) => t.toLowerCase() !== HBAR);
  return seen ?? DEMO_USDC;
}
