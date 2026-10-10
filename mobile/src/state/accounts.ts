import { MOCK } from "../core/data/mock";

export type Role = "owner" | "guardian";

export interface Account {
  id: string;
  role: Role;
  name: string;
  /** Short description shown on the account picker. */
  about: string;
  /** Address in the demo vault. In live mode a guardian uses the key saved on this phone instead. */
  demoAddress: string;
}

/** Demo people. No passwords: tap an account to use it. */
export const ACCOUNTS: Account[] = [
  { id: "amel", role: "owner", name: "Amel", about: "Owner. Sends money and confirms on her puck.", demoAddress: MOCK.puck },
  { id: "yassine", role: "guardian", name: "Yassine", about: "Guardian, her son. Can stop a payment, never move money.", demoAddress: MOCK.guardians[0] },
  { id: "sarra", role: "guardian", name: "Sarra", about: "Guardian, her neighbour. Can stop a payment, never move money.", demoAddress: MOCK.guardians[1] },
];

export const OWNER = ACCOUNTS[0];

export function accountById(id: string | null | undefined): Account | null {
  return ACCOUNTS.find((a) => a.id === id) ?? null;
}
