import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CrossChainAttestationReceiver, MockCCIPRouter } from "../typechain-types";

const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n;
const YEAR = 365 * 24 * 60 * 60;

async function setup() {
  const [owner, sepoliaAttestation, rando] = await ethers.getSigners();

  const router = (await ethers.deployContract("MockCCIPRouter", [0])) as MockCCIPRouter;

  const receiver = (await ethers.deployContract("CrossChainAttestationReceiver", [
    router.target,
    owner.address,
  ])) as CrossChainAttestationReceiver;

  await receiver.connect(owner).setAllowedSender(
    SEPOLIA_CHAIN_SELECTOR,
    sepoliaAttestation.address
  );

  const encode = (wallet: string, tier: number, action: number, expiry?: number) =>
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address", "uint8", "uint64"],
      [action, wallet, tier, expiry ?? Math.floor(Date.now() / 1000) + YEAR]
    );

  const deliver = (wallet: string, tier: number, action = 1, expiry?: number) =>
    router.deliver(
      receiver.target,
      SEPOLIA_CHAIN_SELECTOR,
      sepoliaAttestation.address,
      encode(wallet, tier, action, expiry)
    );

  return { receiver, router, owner, sepoliaAttestation, rando, deliver, encode };
}

describe("CrossChainAttestationReceiver", () => {
  describe("deployment", () => {
    it("sets ccipRouter and owner", async () => {
      const { receiver, router, owner } = await setup();
      expect(await receiver.ccipRouter()).to.equal(router.target);
      expect(await receiver.owner()).to.equal(owner.address);
    });

    it("rejects zero router address", async () => {
      const { owner } = await setup();
      const F = await ethers.getContractFactory("CrossChainAttestationReceiver");
      await expect(F.deploy(ethers.ZeroAddress, owner.address))
        .to.be.revertedWithCustomError(F, "ZeroAddress");
    });

    it("rejects zero owner address", async () => {
      const { router } = await setup();
      const F = await ethers.getContractFactory("CrossChainAttestationReceiver");
      await expect(F.deploy(router.target, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(F, "ZeroAddress");
    });
  });

  describe("setAllowedSender", () => {
    it("registers allowed sender", async () => {
      const { receiver, owner, rando } = await setup();
      await receiver.connect(owner).setAllowedSender(12345n, rando.address);
      expect(await receiver.allowedSenders(12345n)).to.equal(rando.address);
    });

    it("emits AllowedSenderSet", async () => {
      const { receiver, owner, rando } = await setup();
      await expect(receiver.connect(owner).setAllowedSender(12345n, rando.address))
        .to.emit(receiver, "AllowedSenderSet")
        .withArgs(12345n, rando.address);
    });

    it("reverts for non-owner", async () => {
      const { receiver, rando } = await setup();
      await expect(receiver.connect(rando).setAllowedSender(12345n, rando.address))
        .to.be.revertedWithCustomError(receiver, "OwnableUnauthorizedAccount");
    });

    it("reverts for zero address sender", async () => {
      const { receiver, owner } = await setup();
      await expect(receiver.connect(owner).setAllowedSender(12345n, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(receiver, "ZeroAddress");
    });
  });

  describe("ccipReceive", () => {
    it("mirrors attestation on valid message", async () => {
      const { receiver, rando, deliver } = await setup();
      await deliver(rando.address, 2);
      const att = await receiver.getAttestation(rando.address);
      expect(att.tier).to.equal(2);
      expect(att.active).to.be.true;
    });

    it("emits AttestationMirrored", async () => {
      const { receiver, rando, deliver } = await setup();
      await expect(deliver(rando.address, 1))
        .to.emit(receiver, "AttestationMirrored");
    });

    it("stores sourceChainSelector on mirrored attestation", async () => {
      const { receiver, rando, deliver } = await setup();
      await deliver(rando.address, 1);
      const att = await receiver.getAttestation(rando.address);
      expect(att.sourceChainSelector).to.equal(SEPOLIA_CHAIN_SELECTOR);
    });

    it("reverts for unauthorized source chain", async () => {
      const { receiver, router, sepoliaAttestation, rando, encode } = await setup();
      const data = encode(rando.address, 1, 1);
      await expect(
        router.deliver(receiver.target, 99999n, sepoliaAttestation.address, data)
      ).to.be.revertedWithCustomError(receiver, "UnauthorizedSender");
    });

    it("reverts for unauthorized sender address", async () => {
      const { receiver, router, rando, encode } = await setup();
      const data = encode(rando.address, 1, 1);
      await expect(
        router.deliver(receiver.target, SEPOLIA_CHAIN_SELECTOR, rando.address, data)
      ).to.be.revertedWithCustomError(receiver, "UnauthorizedSender");
    });

    it("reverts on duplicate message", async () => {
      const { receiver, rando, deliver } = await setup();
      await deliver(rando.address, 1);
      await expect(deliver(rando.address, 2))
        .to.be.revertedWithCustomError(receiver, "DuplicateMessage");
    });

    it("reverts when called directly not via router", async () => {
      const { receiver, rando, encode } = await setup();
      const msg = {
        messageId:           ethers.ZeroHash,
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        sender:              ethers.AbiCoder.defaultAbiCoder().encode(["address"], [rando.address]),
        data:                encode(rando.address, 1, 1),
        destTokenAmounts:    [],
      };
      await expect(receiver.connect(rando).ccipReceive(msg))
        .to.be.revertedWithCustomError(receiver, "OnlyCCIPRouter");
    });

    it("reverts on invalid payload", async () => {
      const { receiver, router, sepoliaAttestation } = await setup();
      await expect(
        router.deliver(receiver.target, SEPOLIA_CHAIN_SELECTOR, sepoliaAttestation.address, "0x1234")
      ).to.be.revertedWithCustomError(receiver, "InvalidPayload");
    });

    it("action 2 revokes a mirrored attestation", async () => {
      const { receiver, router, sepoliaAttestation, rando, encode } = await setup();
      await router.deliver(
        receiver.target, SEPOLIA_CHAIN_SELECTOR, sepoliaAttestation.address,
        encode(rando.address, 1, 1)
      );
      // Second deliver uses a different messageId because deliver() always uses lastMessageId
      // which starts at bytes32(0). We need to advance it — call ccipSend first.
      await router.ccipSend(12345n, {
        receiver: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [rando.address]),
        data: "0x",
        tokenAmounts: [],
        extraArgs: "0x",
        feeToken: ethers.ZeroAddress,
      });
      await router.deliver(
        receiver.target, SEPOLIA_CHAIN_SELECTOR, sepoliaAttestation.address,
        encode(rando.address, 0, 2)
      );
      const att = await receiver.getAttestation(rando.address);
      expect(att.active).to.be.false;
    });
  });

  describe("verifyAttestation", () => {
    it("returns valid for active mirrored attestation", async () => {
      const { receiver, rando, deliver } = await setup();
      await deliver(rando.address, 2);
      const [valid, tier] = await receiver.verifyAttestation(rando.address, 4);
      expect(valid).to.be.true;
      expect(tier).to.equal(2);
    });

    it("returns invalid for no attestation", async () => {
      const { receiver, rando } = await setup();
      const [valid] = await receiver.verifyAttestation(rando.address, 4);
      expect(valid).to.be.false;
    });

    it("returns invalid when tier is worse than minTier", async () => {
      const { receiver, rando, deliver } = await setup();
      await deliver(rando.address, 4);
      const [valid] = await receiver.verifyAttestation(rando.address, 2);
      expect(valid).to.be.false;
    });

    it("returns invalid after expiry", async () => {
      const { receiver, rando, deliver } = await setup();
      const shortExpiry = Math.floor(Date.now() / 1000) + 60;
      await deliver(rando.address, 1, 1, shortExpiry);
      await time.increase(120);
      const [valid] = await receiver.verifyAttestation(rando.address, 4);
      expect(valid).to.be.false;
    });
  });

  describe("admin", () => {
    it("pause blocks ccipReceive", async () => {
      const { receiver, owner, rando, deliver } = await setup();
      await receiver.connect(owner).pause();
      await expect(deliver(rando.address, 1))
        .to.be.revertedWithCustomError(receiver, "EnforcedPause");
    });

    it("unpause restores ccipReceive", async () => {
      const { receiver, owner, rando, deliver } = await setup();
      await receiver.connect(owner).pause();
      await receiver.connect(owner).unpause();
      await expect(deliver(rando.address, 1)).to.not.be.reverted;
    });

    it("non-owner cannot pause", async () => {
      const { receiver, rando } = await setup();
      await expect(receiver.connect(rando).pause())
        .to.be.revertedWithCustomError(receiver, "OwnableUnauthorizedAccount");
    });

    it("supportsInterface returns true for IAny2EVMMessageReceiver", async () => {
      const { receiver } = await setup();
      expect(await receiver.supportsInterface("0x85572ffb")).to.be.true;
    });

    it("supportsInterface returns true for IERC165", async () => {
      const { receiver } = await setup();
      expect(await receiver.supportsInterface("0x01ffc9a7")).to.be.true;
    });
  });
});
