# Security checks on the testnet vault

Vault `0.0.10887434` (`0xf05B6cF51213a491c88B68EE539E7eD2E7AFbd5c`), run 2026-10-06T10:14:28.742Z. Calls are read-only simulations against Hashio, so they cost nothing and change nothing.

Check 1 (contract test suite with the malicious receiver) runs with `npm -w contracts test`; it also covers a stranger approving or stopping a live settings change, which needs a waiting change to test. Check 4 also has the on-chain Day-1 test 5 in `DAY1_RESULTS.md`.

## Check 2: every signed function refuses a stranger's key

| Result | Call | Detail |
|---|---|---|
| PASS | propose | reverted with BadSignature |
| PASS | agentPay | reverted with BadSignature |
| PASS | reconfirm | reverted with BadSignature |
| PASS | approve | reverted with NotGuardian |
| PASS | veto | reverted with NotGuardian |
| PASS | cancel | reverted with BadSignature |
| PASS | freeze | reverted with NotAllowed |
| PASS | proposeChange | reverted with NotPuck |

## Check 3: no person holds an admin key

| Result | Call | Detail |
|---|---|---|
| PASS | contract admin key on the mirror node | the admin key is the contract itself, `{"_type":"ProtobufEncoded","key":"0a05188ac29805"}` (contract 0.0.10887434, https://hashscan.io/testnet/contract/0xf05B6cF51213a491c88B68EE539E7eD2E7AFbd5c) |

## Check 4: one changed byte breaks the puck's signature

| Result | Call | Detail |
|---|---|---|
| PASS | propose with amount 100 signed, 101 sent | reverted with BadSignature |
| PASS | propose with one signature byte flipped | reverted with BadSignature |

## Checks 5 and 6: closed payments stay closed

| Result | Call | Detail |
|---|---|---|
| PASS | execute vetoed payment 3 | reverted with NotPending |
| PASS | execute payment 5 closed by the freeze, after the unfreeze | reverted with NotPending |
| PASS | reconfirm payment 5 after the unfreeze | reverted with NotPending |
