export const TESTNET = {
  chainId: 296,
  rpc: "https://testnet.hashio.io/api",
  mirror: "https://testnet.mirrornode.hedera.com",
  hashscan: "https://hashscan.io/testnet",
} as const;

export const SCHEDULE_SERVICE = "0x000000000000000000000000000000000000016b";

export function hashscanTx(id: string): string {
  return `${TESTNET.hashscan}/transaction/${id}`;
}

export function hashscanContract(address: string): string {
  return `${TESTNET.hashscan}/contract/${address}`;
}

export function hashscanTopic(id: string): string {
  return `${TESTNET.hashscan}/topic/${id}`;
}

export function hashscanSchedule(id: string): string {
  return `${TESTNET.hashscan}/schedule/${id}`;
}

export function hashscanAccount(id: string): string {
  return `${TESTNET.hashscan}/account/${id}`;
}

export function evmAddressToEntityId(address: string): string | null {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!/^0{24}[0-9a-f]{16}$/.test(hex)) return null;
  return `0.0.${BigInt("0x" + hex.slice(24)).toString()}`;
}
