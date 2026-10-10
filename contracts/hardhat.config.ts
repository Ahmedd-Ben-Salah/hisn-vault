import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "..", ".env") });

const relayerKey = process.env.RELAYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 296,
      allowUnlimitedContractSize: false,
      accounts: { accountsBalance: "1000000000000000000000000" },
    },
    hederaTestnet: {
      url: process.env.RPC_URL ?? "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: relayerKey ? [relayerKey] : [],
      timeout: 120000,
    },
  },
  mocha: { timeout: 120000 },
};

export default config;
