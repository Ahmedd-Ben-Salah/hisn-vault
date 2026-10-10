# Hedera numbers from our testnet runs

Vault `0.0.10896159`, public log `0.0.10896165`, read from the mirror node on 2026-10-06T21:46:55.770Z. Dollar values use Hedera's published exchange rate at that time (0.0999 USD per HBAR). Testnet fees mirror mainnet's fee schedule.

## One protected payment that waits, then is released by the network

| Step | Hedera service | Average fee |
|---|---|---|
| Puck-signed proposal | Smart contract call | $0.019 |
| Puck-signed second confirmation, which books the release | Smart contract call + Schedule Service | $0.128 |
| Release at the chosen second, run by the network and paid by the vault | Scheduled transaction | $0.0061 |
| About 5.4 signed entries in the public log | Consensus Service | $0.0018 |
| **Total** | | **$0.155** |

## Everything this vault has done so far

| Call | Count | Average fee | Average gas |
|---|---|---|---|
| propose | 10 | $0.019 | 222,697 |
| execute (by the network) | 4 | $0.0061 | n/a |
| veto | 2 | $0.0052 | 61,612 |
| approve | 2 | $0.126 | 1,481,799 |
| proposeChange | 2 | $0.016 | 193,568 |
| approveChange | 2 | $0.0043 | 51,007 |
| reconfirm | 2 | $0.128 | 1,506,046 |
| freeze | 2 | $0.0062 | 72,823 |
| deploy | 1 | $0.441 | 5,194,898 |
| associateToken | 1 | $0.062 | 735,042 |

- Contract transactions: **28**, of which **4** were executed by the network on its own schedule, paid from the vault's own HBAR reserve.
- Schedules created by the vault: **4** (4 executed, 0 deleted after a stop or freeze).
- Public-log messages: **77** (PROPOSED 15, REQUEST 10, PAY_SIGNED 10, RELEASED 9, ALERT_ACK 8, CONFIRMED 4, VETOED 3, FROZEN 3, CANCELLED 3, VETO_SIGNED 2, APPROVE_SIGNED 2, APPROVED 2, CHANGE_SIGNED 2, CHANGE_APPROVED 2, RECONFIRM_SIGNED 2). Average fee per message $0.0003.
