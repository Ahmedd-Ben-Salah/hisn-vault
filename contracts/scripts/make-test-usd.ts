import { TokenCreateTransaction, TokenType, TokenSupplyType, AccountId, PrivateKey, Hbar } from "@hashgraph/sdk";
import { hederaClient } from "./lib/hcs";
import { need, opt, setEnv } from "./lib/env";

async function main() {
  const existing = opt("DEMO_USD_TOKEN_ID");
  if (existing && !process.argv.includes("--fresh")) {
    console.log(`already created: ${existing}`);
    return;
  }
  const client = hederaClient();
  const treasury = AccountId.fromString(need("RELAYER_ACCOUNT_ID"));
  const key = PrivateKey.fromStringECDSA(need("RELAYER_PRIVATE_KEY").replace(/^0x/, ""));
  const tx = await new TokenCreateTransaction()
    .setTokenName("USD Coin (HISN testnet stand-in)")
    .setTokenSymbol("tUSDC")
    .setTokenMemo("Testnet stand-in for USDC used in the HISN demo. No value.")
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(1_000_000_000_000)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(1_000_000_000_000)
    .setTreasuryAccountId(treasury)
    .setAutoRenewAccountId(treasury)
    .setMaxTransactionFee(new Hbar(40))
    .freezeWith(client)
    .sign(key);
  const rx = await (await tx.execute(client)).getReceipt(client);
  const id = rx.tokenId!;
  const evm = "0x" + id.toSolidityAddress();
  setEnv({ DEMO_USD_TOKEN_ID: id.toString(), USDC_ADDRESS: evm });
  console.log(`token ${id.toString()} evm ${evm}`);
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
