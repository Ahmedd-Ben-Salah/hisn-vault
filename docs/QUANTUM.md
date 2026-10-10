# Quantum-resistant signatures in Hisn

**One line for the pitch:** the owner's money can only move with a hash-based signature made on the ESP32 puck, and the vault checks it on the Hedera network. A quantum computer that breaks ECDSA still cannot forge it.

We say **quantum-resistant** (or "quantum-safe signatures"), never "quantum-proof": nothing is proof against every future attack, and some parts of the system stay classical (listed below).

## Why ECDSA alone is not enough

Every Hedera and Ethereum wallet signs with elliptic-curve keys (ECDSA secp256k1 or Ed25519). Shor's algorithm, on a large enough quantum computer, recovers the private key from the public key. Public keys are visible on-chain as soon as an account signs once. Someone who records them today can forge signatures later ("harvest now, forge later").

Hash functions are different. The best known quantum attack on Keccak-256 is Grover's algorithm, which only halves the security level: 256 bits becomes about 128 bits, which is still out of reach. Signatures built only from hashes (Lamport, WOTS, XMSS, SPHINCS+, the last standardised by NIST as SLH-DSA) therefore stay secure.

## What we built

The puck now signs every action that can move money or change the rules **twice**:

1. **ECDSA** (secp256k1), as before.
2. **WOTS+ one-time signature** (Winternitz, w = 16) under a **Merkle tree** of 2^8 = 256 one-time keys (an XMSS-style construction). It is built only from Keccak-256.

The vault (`HisnVault`) stores the Merkle root. While a root is set, `proposePQ`, `reconfirmPQ` and `proposeChangePQ` require **both** signatures over the same digest, and the classical-only functions revert with `PqRequired`. This is a **hybrid**: an attacker has to break ECDSA **and** Keccak-256.

| Action | Signed by | Hash-based signature required |
|---|---|---|
| Propose a payment | puck | **yes** |
| Confirm again (second yes on a waiting payment) | puck | **yes** |
| Settings change (limits, payees, guardians, cool-off, new hash-based keys) | puck | **yes** |
| Cancel / stop / freeze | puck, guardian, light | no (these can only stop money, never move it) |

### Why the ESP32 matters here

- **The seed never leaves the puck.** It is derived from the puck's PIN-protected key, `seed = keccak256("HISN_PQ_SEED" ‖ priv)`, so there is no second secret to store or back up.
- **One-time keys must never be reused.** A WOTS key that signs two different messages leaks enough to forge. The puck writes the next index to flash **before** it releases a signature, so a power cut skips a key instead of reusing it. The vault also marks each leaf used (`PqLeafUsed`).
- **The puck has its own screen.** The owner checks the amount and address on the device, not on a phone that could be compromised.
- **No phone wallet, no browser extension.** The hash-based signer runs on a device with no app store and no remote software updates in normal use.

## How it works

Byte layouts are identical in three places: TypeScript (`shared/src/pq.ts`), Solidity (`contracts/contracts/HisnPQVerifier.sol`) and C for the ESP32 (`firmware/lib/hisn_crypto/src/hisn_pq.c`).

```
sk(i)    = keccak256(0x00 ‖ seed ‖ leaf[4] ‖ i[1])                 secret start of chain i
F(x)     = keccak256(0x01 ‖ leaf[4] ‖ i[1] ‖ j[1] ‖ x)             one step along a chain (tweaked hash)
leaf     = keccak256(0x02 ‖ end_0 ‖ … ‖ end_66)                     end_i = chain i after 15 steps
node     = keccak256(0x03 ‖ left ‖ right)                           Merkle tree, root stored in the vault
message  = keccak256(PQ_TAG ‖ chainId ‖ vault ‖ leaf[4] ‖ digest)   bound to this vault, chain and key index
digits   = 64 nibbles of message + 3 checksum nibbles (sum of 15 - d)
sign     : chain i advanced d_i steps from sk(i), plus the Merkle path
verify   : advance each chain the remaining 15 - d_i steps, rebuild the leaf, walk the path, compare with the root
```

The checksum makes forging impossible by "advancing" chains: raising any message digit lowers the checksum, which would require going backwards along a hash chain.

**Contract size.** The verifier is a separate stateless contract (`HisnPQVerifier`), set once in the vault's constructor (immutable), because the vault alone is close to the 24 KB contract-size limit. Anyone can call `check(...)` to verify a signature independently.

## Numbers (measured)

| | Value |
|---|---|
| Signature size | 2,496 bytes (67 × 32 chains + 8 × 32 path + header), within Hedera's 6 KB transaction limit |
| Extra gas per signed action | about 200,000 (450,789 for `proposePQ` vs 251,233 for `propose`) |
| Keys per puck | 256 (height 8). A waiting payment uses 2, an instant one uses 1 |
| Key generation | 257,280 Keccak calls: 0.4 s on a laptop; estimated 10 to 20 s on the ESP32, once after each start |
| Puck RAM for the tree | 16 KB (511 nodes × 32 bytes) |

## Tests that prove it

- `shared/test/pq.test.ts`: sign and verify every leaf; a changed digest, vault, chain, leaf, chain value or path fails.
- `contracts/test/vault.pq.test.ts`, 12 tests:
  - the classical-only path is refused;
  - ECDSA plus a valid hash-based signature pays;
  - **valid ECDSA plus a forged hash-based signature fails** (the quantum-attacker case);
  - a signature cannot be moved to another payment or another vault;
  - a key cannot be reused;
  - confirm-again and settings changes need one too;
  - key rotation works;
  - the freeze cooldown works.
- `firmware/test/test_pq`: the C code produces **the same root and the same signature bytes** as TypeScript (vectors from `npm -w shared run vectors`).
- The full end-to-end story (`npm -w backend run e2e:local`, "ALL PASSED") runs with the hash-based layer switched on. The simulated puck makes the signatures and the vault checks 7 of them on-chain.

## Running out of keys, a lost puck, rotation

- **Rotation:** the `SET_PQ_ROOT` settings change installs a fresh tree. It is itself signed with ECDSA plus one of the remaining hash-based keys, waits the settings delay, and needs a guardian's approval. The puck warns "NO QUANTUM KEYS LEFT" when it runs out. The dashboard shows how many keys are left (Protection page, and on Home).
- **Lost puck:** `RECOVER_PUCK` (two guardians plus the recovery delay, and the old puck can stop it) clears the old root, because the old puck's keys go with it. The new puck then installs its own with `SET_PQ_ROOT`.

## What stays classical (say this if asked)

1. **Hedera transaction signatures.** The relayer pays gas with an ECDSA or Ed25519 account. A quantum attacker who takes over the relayer account still cannot move money: the vault ignores who sends the transaction and checks the puck's signatures. Hedera has announced post-quantum work for its own account keys.
2. **Guardian and alarm-light keys** are ECDSA. Forging them lets an attacker **stop** or **freeze**, and approve a payment that the puck already signed with its hash-based key. They cannot create a payment. **Recovery** (`RECOVER_PUCK`) is the one path that needs two guardian keys and no puck signature. The owner's puck can still stop it during the recovery delay, and the stop alarm fires. A hash-based key for the guardian light is the next step.
3. **The helper agent's key** is ECDSA and server-held. It is capped by the contract to saved names and a daily allowance (20 USDC in the demo). A quantum attacker could spend at most that allowance.
4. **Not audited.** The scheme is a simplified, XMSS-style construction (tweaked hashes instead of XMSS bitmasks), written for this hackathon. Production would use a standard: SLH-DSA (SPHINCS+, FIPS 205) or XMSS (RFC 8391).

## Demo script (30 seconds)

1. "Most wallets would be forgeable by a big enough quantum computer. Ours needs a second, hash-based signature that only this puck can make."
2. Send a payment. Point at Protection: "Quantum-safe signatures on · 243 of 256 left".
3. HashScan: the `PqSigned` event next to `Proposed`.
4. "If someone breaks the ECDSA key, the vault still says no. That's a contract test: valid ECDSA, forged hash-based signature, `PqBadSignature`."

## Setup

- **Real puck:** after the PIN is created, the puck prints `pq root 0x…`. The console command `pq` shows it again with the number of keys left. Deploy with `PQ_ROOT=0x… npm -w contracts run deploy:testnet`.
- **Simulated puck:** the deploy derives the root from `SIM_PUCK_PRIVATE_KEY`. `PQ=0` deploys a classical-only vault, which is what all vaults deployed before this change are.
- **Relayer token on the puck:** the relayer now requires its token on `/device`. Set it on each device with the console command `token <RELAYER_API_TOKEN>`.
