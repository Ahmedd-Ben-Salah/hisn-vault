# Lost-puck recovery on testnet

Run 2026-10-06T20:28:30.516Z on a throwaway vault (https://hashscan.io/testnet/contract/0x2c20B372eE0b4dC60518ee809f52B34168d1E59E) with the same contract as the demo vault, fresh random keys, and a 120 s recovery delay. The demo vault was not touched. Not part of the live demo.

## Run A: the old puck cancels a recovery

| Result | Step | Detail |
|---|---|---|
| PASS | guardian proposes a new puck 0xAE53447D… | https://hashscan.io/testnet/transaction/0x9a168cd6fa6818d5ece4ef9d2edeef92859801426b3cfdde00063c79a2428547 |
| PASS | the owner's puck stops it | change 1 is VETOED https://hashscan.io/testnet/transaction/0xbf1e96dea6a9eeb10ab4c839f5b270b9dec330e58945e32f0af395a54e0996b3 |
| PASS | the puck is unchanged | 0xE0F698540ace767956E5DcEcf27451D6EBe73dD7 |

## Run B: two different guardians replace a lost puck

| Result | Step | Detail |
|---|---|---|
| PASS | guardian proposes a new puck 0xce0c9a68… | https://hashscan.io/testnet/transaction/0xbe082650209ec70d233f196051a70ef315325bea7e60e703fc4173df6445749b |
| PASS | applying it with no second guardian | reverted with NotConfirmed |
| PASS | the proposing guardian approving its own recovery | reverted with SameApprover |
| PASS | a second guardian approves | https://hashscan.io/testnet/transaction/0xacfd365fb4a4758ecb7cf0350c556b25658c794d3d1f5a8f1a7067680bf56d46 |
| PASS | applying it before the recovery delay | reverted with NotReady |
| PASS | applied after the 120 s delay | puck is now 0xce0c9a682b8924cd70a41ffF094f6093305ba93e https://hashscan.io/testnet/transaction/0x53b53464afcb87747023c941f5c24a4c187757ed315bd12278a340040b09b69c |
| PASS | the old puck can no longer sign a payment | reverted with BadSignature |
| PASS | the new puck signs a payment | accepted in simulation, nothing sent |
