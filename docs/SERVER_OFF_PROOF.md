# The network releases a payment with our server off

Run 2026-10-06T20:22:11.987Z on Hedera testnet, vault 0xf05B6cF51213a491c88B68EE539E7eD2E7AFbd5c (https://hashscan.io/testnet/contract/0xf05B6cF51213a491c88B68EE539E7eD2E7AFbd5c). Result: **PASS**.

The relayer was not running at any point. Only two transactions came from our side, both carrying the puck's signature: the payment and the second confirmation. The release was a scheduled transaction that Hedera itself executed at the release time.

- 1. Puck-signed payment #6: 60 USDC to 0xF4C9E925D3029D59E05a4AA315AbF82B9642831f, WAIT tier, release at 2026-10-06T20:21:38.000Z. https://hashscan.io/testnet/transaction/0xd000dc44d587fde8443169bf3a1dd7244abe24a97619362bd4da62a1e45026ce
- 2. Puck-signed second confirmation; the vault created schedule 0.0.10895382. https://hashscan.io/testnet/transaction/0xa87e4614cf0ecd648e70e3f4673228729308454ba43785372348c5a243d70ed2
- 3. From here nothing of ours sends a transaction. Relayer running on this machine: no.
- 4. Schedule 0.0.10895382 executed at consensus time 1791318103.058468999: transaction 0.0.7314364-1791318071-266827859, scheduled=true, result SUCCESS, payer 0.0.10887434.
- 5. Payment #6 status EXECUTED. Recipient balance 11000000 -> 71000000 (moved 60000000). Relayer running: no.

Check it yourself:

- Schedule: https://hashscan.io/testnet/schedule/0.0.10895382
- Release transaction: https://hashscan.io/testnet/transaction/1791318103.058468999
