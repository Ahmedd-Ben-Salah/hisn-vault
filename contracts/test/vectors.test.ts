import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { AbiCoder, dataSlice } from "ethers";
import vectors from "../../shared/test-vectors.json";
import { deploy } from "./fixture";

const vectorFixture = () => deploy();

describe("Digest layout matches shared/test-vectors.json", () => {
  it("every vector digest equals the contract's own digest", async () => {
    const f = await loadFixture(vectorFixture);
    const code = await ethers.provider.getCode(await f.vault.getAddress());
    await network.provider.send("hardhat_setCode", [vectors.vault, code]);
    const at = await ethers.getContractAt("HisnVault", vectors.vault);
    for (const c of vectors.cases) {
      const fields = dataSlice(c.encoded, 128);
      expect(await at.digestFor(c.action, fields), c.name).to.equal(c.digest);
    }
    expect(AbiCoder.defaultAbiCoder()).to.exist;
  });
});
