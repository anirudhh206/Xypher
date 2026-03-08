import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { CreditIdentityNFT, ConfidentialGuardAttestation } from "../typechain-types";

const YEAR = 365 * 24 * 60 * 60;

async function setup() {
  const [owner, workflow, user1, user2, user3, rando] = await ethers.getSigners();

  const attestation = (await ethers.deployContract(
    "ConfidentialGuardAttestation",
    [owner.address]
  )) as ConfidentialGuardAttestation;

  await attestation.connect(owner).setWorkflowAddress(workflow.address);

  const nft = (await ethers.deployContract("CreditIdentityNFT", [
    attestation.target,
    owner.address,
  ])) as CreditIdentityNFT;

  const mint = async (signer: HardhatEthersSigner, tier: number) => {
    await attestation.connect(signer).grantPermission();
    // Pass 0n so the contract derives expiry from block.timestamp + 24h (safe regardless of EVM time)
    await attestation.connect(workflow).mintAttestation(signer.address, tier, 0n);
  };

  return { nft, attestation, owner, workflow, user1, user2, user3, rando, mint };
}

describe("CreditIdentityNFT", () => {
  describe("deployment", () => {
    it("sets attestationRegistry and owner", async () => {
      const { nft, attestation, owner } = await setup();
      expect(await nft.attestationRegistry()).to.equal(attestation.target);
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("has correct name and symbol", async () => {
      const { nft } = await setup();
      expect(await nft.name()).to.equal("ConfidentialGuard Credit Identity");
      expect(await nft.symbol()).to.equal("CGCI");
    });

    it("rejects zero addresses", async () => {
      const { attestation, owner } = await setup();
      const F = await ethers.getContractFactory("CreditIdentityNFT");
      await expect(F.deploy(ethers.ZeroAddress, owner.address))
        .to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(attestation.target, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(F, "OwnableInvalidOwner");
    });
  });

  describe("minting", () => {
    it("mints when valid attestation exists", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await expect(nft.connect(user1).mint()).to.not.be.reverted;
      expect(await nft.balanceOf(user1.address)).to.equal(1);
    });

    it("emits CreditIdentityMinted with correct tier", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 2);
      await expect(nft.connect(user1).mint())
        .to.emit(nft, "CreditIdentityMinted")
        .withArgs(user1.address, 1n, 2);
    });

    it("emits Locked on mint", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await expect(nft.connect(user1).mint())
        .to.emit(nft, "Locked")
        .withArgs(1n);
    });

    it("rejects mint with no attestation", async () => {
      const { nft, rando } = await setup();
      await expect(nft.connect(rando).mint())
        .to.be.revertedWithCustomError(nft, "NoAttestation");
    });

    it("rejects double mint from same wallet", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      await expect(nft.connect(user1).mint())
        .to.be.revertedWithCustomError(nft, "AlreadyMinted");
    });

    it("each wallet gets a unique token id", async () => {
      const { nft, user1, user2, mint } = await setup();
      await mint(user1, 1);
      await mint(user2, 2);
      await nft.connect(user1).mint();
      await nft.connect(user2).mint();
      expect(await nft.tokenOf(user1.address)).to.equal(1n);
      expect(await nft.tokenOf(user2.address)).to.equal(2n);
    });
  });

  describe("soulbound", () => {
    it("locked() returns true", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);
      expect(await nft.locked(tokenId)).to.be.true;
    });

    it("transfer reverts with Soulbound", async () => {
      const { nft, user1, user2, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);
      await expect(
        nft.connect(user1).transferFrom(user1.address, user2.address, tokenId)
      ).to.be.revertedWithCustomError(nft, "Soulbound");
    });

    it("approve reverts with Soulbound", async () => {
      const { nft, user1, user2, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);
      await expect(nft.connect(user1).approve(user2.address, tokenId))
        .to.be.revertedWithCustomError(nft, "Soulbound");
    });

    it("setApprovalForAll reverts with Soulbound", async () => {
      const { nft, user1, user2 } = await setup();
      await expect(nft.connect(user1).setApprovalForAll(user2.address, true))
        .to.be.revertedWithCustomError(nft, "Soulbound");
    });
  });

  describe("burn", () => {
    it("wallet can burn their own NFT", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      await expect(nft.connect(user1).burn()).to.not.be.reverted;
      expect(await nft.balanceOf(user1.address)).to.equal(0);
    });

    it("emits CreditIdentityBurned", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);
      await expect(nft.connect(user1).burn())
        .to.emit(nft, "CreditIdentityBurned")
        .withArgs(user1.address, tokenId);
    });

    it("clears tokenOf mapping after burn", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      await nft.connect(user1).burn();
      expect(await nft.tokenOf(user1.address)).to.equal(0n);
    });

    it("allows re-mint after burn", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      await nft.connect(user1).burn();
      await expect(nft.connect(user1).mint()).to.not.be.reverted;
    });

    it("reverts burn with no NFT", async () => {
      const { nft, rando } = await setup();
      await expect(nft.connect(rando).burn())
        .to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
    });
  });

  describe("syncTier", () => {
    it("updates tier when attestation changes", async () => {
      const { nft, attestation, workflow, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);

      await time.increase(6 * 60 * 60 + 1);
      const block1 = await ethers.provider.getBlock('latest');
      const expiry = block1!.timestamp + YEAR * 2;
      await attestation.connect(workflow).mintAttestation(user1.address, 3, expiry);
      await nft.syncTier(user1.address);

      expect(await nft.tierOf(tokenId)).to.equal(3);
    });

    it("emits CreditIdentityUpdated on tier change", async () => {
      const { nft, attestation, workflow, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);

      await time.increase(6 * 60 * 60 + 1);
      const block2 = await ethers.provider.getBlock('latest');
      const expiry2 = block2!.timestamp + YEAR * 2;
      await attestation.connect(workflow).mintAttestation(user1.address, 3, expiry2);
      await expect(nft.syncTier(user1.address))
        .to.emit(nft, "CreditIdentityUpdated")
        .withArgs(tokenId, 1, 3);
    });

    it("burns NFT when attestation is revoked", async () => {
      const { nft, attestation, owner, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      await attestation.connect(owner).adminRevokeAttestation(user1.address);
      await nft.syncTier(user1.address);
      expect(await nft.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("tokenURI", () => {
    it("returns base64 encoded json", async () => {
      const { nft, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(user1).mint();
      const tokenId = await nft.tokenOf(user1.address);
      const uri = await nft.tokenURI(tokenId);
      expect(uri).to.include("data:application/json;base64,");
    });

    it("reverts for non-existent token", async () => {
      const { nft } = await setup();
      await expect(nft.tokenURI(999n))
        .to.be.revertedWithCustomError(nft, "TokenDoesNotExist");
    });
  });

  describe("admin", () => {
    it("pause blocks minting", async () => {
      const { nft, owner, user1, mint } = await setup();
      await mint(user1, 1);
      await nft.connect(owner).pause();
      await expect(nft.connect(user1).mint())
        .to.be.revertedWithCustomError(nft, "EnforcedPause");
    });

    it("supportsInterface returns true for ERC5192", async () => {
      const { nft } = await setup();
      expect(await nft.supportsInterface("0xb45a3c0e")).to.be.true;
    });
  });
});
