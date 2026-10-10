import { artifacts } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const dir = resolve(__dirname, "..", "..", "shared", "abi");
  mkdirSync(dir, { recursive: true });
  for (const name of ["HisnVault", "HisnVaultPQ"]) {
    try {
      const a = await artifacts.readArtifact(name);
      writeFileSync(resolve(dir, `${name}.json`), JSON.stringify({ contractName: name, abi: a.abi }, null, 2) + "\n");
      console.log(`exported ${name}`);
    } catch {
      console.log(`skipped ${name}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
