import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const ETH_PRICE = 3_000 * 1e8;
const ONE_ETH = ethers.parseEther("1");
const YEAR = 365 * 24 * 60 * 60;

async function setup() {
  const [owner, workflow, lender, b1, b2, b3, liquidator, rando] =
    await ethers.getSigners();

  const priceFeed = await ethers.deployContract("MockPriceFeed", [
    ETH_PRICE,
    8,
    "ETH / USD",
  ]);

  const attestation = await ethers.deployContract(
    "ConfidentialGuardAttestation",
    [owner.address]
  );
  await attestation.connect(owner).setWorkflowAddress(workflow.address);

  const lenderContract = await ethers.deployContract("ConfidentialLender", [
    attestation.target,
    priceFeed.target,
    owner.address,
  ]);

  const mint = async (signer: HardhatEthersSigner, tier: number) => {
    await attestation.connect(signer).grantPermission();
    await attestation.connect(workflow).mintAttestation(signer.address, tier, 0n);
  };

  const seedPool = async (amount = ONE_ETH) => {
    await lenderContract.connect(lender).depositLiquidity({ value: amount });
  };

  const depositCollateral = async (signer: HardhatEthersSigner, amount = ONE_ETH) => {
    await lenderContract.connect(signer).depositCollateral({ value: amount });
  };

  return {
    lenderContract, attestation, priceFeed,
    owner, lender, b1, b2, b3, liquidator, rando,
    mint, seedPool, depositCollateral,
  };
}

describe("ConfidentialLender", () => {
  describe("deployment", () => {
    it("wires registry, feed and owner", async () => {
      const { lenderContract, attestation, priceFeed, owner } = await setup();
      expect(await lenderContract.attestationRegistry()).to.equal(attestation.target);
      expect(await lenderContract.ethUsdFeed()).to.equal(priceFeed.target);
      expect(await lenderContract.owner()).to.equal(owner.address);
    });

    it("sets tier LTVs 90/80/70/60/0", async () => {
      const { lenderContract } = await setup();
      expect(await lenderContract.tierMaxLTV(1)).to.equal(9000);
      expect(await lenderContract.tierMaxLTV(2)).to.equal(8000);
      expect(await lenderContract.tierMaxLTV(3)).to.equal(7000);
      expect(await lenderContract.tierMaxLTV(4)).to.equal(6000);
      expect(await lenderContract.tierMaxLTV(5)).to.equal(0);
    });

    it("rejects zero addresses", async () => {
      const { attestation, priceFeed, owner } = await setup();
      const F = await ethers.getContractFactory("ConfidentialLender");
      await expect(F.deploy(ethers.ZeroAddress, priceFeed.target, owner.address))
        .to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(attestation.target, ethers.ZeroAddress, owner.address))
        .to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(attestation.target, priceFeed.target, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(F, "OwnableInvalidOwner");
    });
  });

  describe("liquidity", () => {
    it("tracks deposits and emits event", async () => {
      const { lenderContract, lender } = await setup();
      await expect(lenderContract.connect(lender).depositLiquidity({ value: ONE_ETH }))
        .to.emit(lenderContract, "LiquidityDeposited")
        .withArgs(lender.address, ONE_ETH);
      expect(await lenderContract.lenderBalances(lender.address)).to.equal(ONE_ETH);
    });

    it("withdraws available liquidity", async () => {
      const { lenderContract, lender } = await setup();
      await lenderContract.connect(lender).depositLiquidity({ value: ONE_ETH });
      await lenderContract.connect(lender).withdrawLiquidity(ONE_ETH);
      expect(await lenderContract.lenderBalances(lender.address)).to.equal(0);
    });

    it("blocks withdrawal when liquidity is borrowed", async () => {
      const { lenderContract, lender, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool();
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.8"));
      await expect(lenderContract.connect(lender).withdrawLiquidity(ONE_ETH))
        .to.be.revertedWithCustomError(lenderContract, "InsufficientLiquidity");
    });

    it("rejects dust deposits", async () => {
      const { lenderContract, lender } = await setup();
      await expect(
        lenderContract.connect(lender).depositLiquidity({ value: ethers.parseEther("0.0001") })
      ).to.be.revertedWithCustomError(lenderContract, "AmountTooSmall");
    });
  });

  describe("collateral", () => {
    it("accepts deposit and tracks balance", async () => {
      const { lenderContract, b1 } = await setup();
      await lenderContract.connect(b1).depositCollateral({ value: ONE_ETH });
      const [collateral] = await lenderContract.getPosition(b1.address);
      expect(collateral).to.equal(ONE_ETH);
    });

    it("allows full withdrawal with no borrow", async () => {
      const { lenderContract, b1 } = await setup();
      await lenderContract.connect(b1).depositCollateral({ value: ONE_ETH });
      await lenderContract.connect(b1).withdrawCollateral(ONE_ETH);
      const [collateral] = await lenderContract.getPosition(b1.address);
      expect(collateral).to.equal(0);
    });

    it("blocks withdrawal that would breach health factor", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      await expect(lenderContract.connect(b1).withdrawCollateral(ONE_ETH))
        .to.be.revertedWithCustomError(lenderContract, "HealthFactorTooLow");
    });
  });

  describe("borrowing", () => {
    it("tier 1 allows 90% LTV", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.9")))
        .to.not.be.reverted;
    });

    it("tier 4 allows 60% and blocks 70%", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 4);
      await depositCollateral(b1);
      // With 1 ETH collateral and 60% max LTV, max borrow = 0.6 ETH
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.6")))
        .to.not.be.reverted;
      // Any further borrow exceeds 60% LTV
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.1")))
        .to.be.revertedWithCustomError(lenderContract, "ExceedsMaxLTV");
    });

    it("rejects borrow with no attestation", async () => {
      const { lenderContract, rando, seedPool, depositCollateral } = await setup();
      await seedPool();
      await depositCollateral(rando);
      await expect(lenderContract.connect(rando).borrow(ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(lenderContract, "NoValidAttestation");
    });

    it("rejects tier 5", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool();
      await mint(b1, 5);
      await depositCollateral(b1);
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(lenderContract, "NoValidAttestation");
    });

    it("rejects borrow when pool is empty", async () => {
      const { lenderContract, b1, mint, depositCollateral } = await setup();
      await mint(b1, 1);
      await depositCollateral(b1);
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(lenderContract, "InsufficientLiquidity");
    });

    it("emits Borrowed with tier and ltv", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.5")))
        .to.emit(lenderContract, "Borrowed")
        .withArgs(b1.address, ethers.parseEther("0.5"), 1, 9000);
    });

    it("updates pool totalBorrowed", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      const [, borrowed] = await lenderContract.getPoolStats();
      expect(borrowed).to.equal(ethers.parseEther("0.5"));
    });
  });

  describe("repayment", () => {
    it("clears position on full repay", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      await lenderContract.connect(b1).repay({ value: ethers.parseEther("0.6") });
      const [, borrowed] = await lenderContract.getPosition(b1.address);
      expect(borrowed).to.equal(0);
    });

    it("accrues ~5% interest over a year", async () => {
      const { lenderContract, priceFeed, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      const borrowAmount = ethers.parseEther("0.5");
      await lenderContract.connect(b1).borrow(borrowAmount);
      await time.increase(YEAR);
      // Refresh price feed timestamp — view calls check staleness
      await priceFeed.setPrice(BigInt(ETH_PRICE));
      const [, , interest] = await lenderContract.getPosition(b1.address);
      const expected = (borrowAmount * 500n) / 10000n;
      expect(interest).to.be.closeTo(expected, ethers.parseEther("0.001"));
    });

    it("rejects repay with insufficient ETH", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      await expect(lenderContract.connect(b1).repay({ value: ethers.parseEther("0.1") }))
        .to.be.revertedWithCustomError(lenderContract, "InsufficientRepayment");
    });

    it("rejects repay with no position", async () => {
      const { lenderContract, rando } = await setup();
      await expect(lenderContract.connect(rando).repay({ value: ONE_ETH }))
        .to.be.revertedWithCustomError(lenderContract, "NoBorrowPosition");
    });
  });

  describe("liquidation", () => {
    async function crashedPosition() {
      const ctx = await setup();
      const { lenderContract, priceFeed, b1, mint, seedPool, depositCollateral } = ctx;
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      // Borrow 90% LTV (max for tier 1). With linear 5%/yr interest, after 3.5 years:
      //   interest ≈ 0.9 × 5% × 3.5 = 0.1575 ETH → total debt ≈ 1.0575 ETH
      //   HF = collateral(1) × 10500 / debt(1.0575) ≈ 9929 BPS < 10000 → liquidatable
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.9"));
      await time.increase(Math.ceil(3.5 * YEAR));
      // Refresh price feed timestamp to avoid StalePriceFeed revert in view calls
      await priceFeed.setPrice(BigInt(ETH_PRICE));
      return ctx;
    }

    it("liquidates underwater position", async () => {
      const { lenderContract, b1, liquidator } = await crashedPosition();
      await expect(
        lenderContract.connect(liquidator).liquidate(b1.address, { value: ethers.parseEther("1.2") })
      ).to.emit(lenderContract, "Liquidated");
    });

    it("rejects liquidation of healthy position", async () => {
      const { lenderContract, b1, liquidator, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      await expect(
        lenderContract.connect(liquidator).liquidate(b1.address, { value: ONE_ETH })
      ).to.be.revertedWithCustomError(lenderContract, "PositionHealthy");
    });

    it("rejects underpaid liquidation", async () => {
      const { lenderContract, b1, liquidator } = await crashedPosition();
      await expect(
        lenderContract.connect(liquidator).liquidate(b1.address, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWithCustomError(lenderContract, "InsufficientRepayment");
    });

    it("liquidation clears the underwater position", async () => {
      // In a single-asset pool (ETH collateral, ETH debt), the liquidator covers the
      // outstanding debt and receives the borrower's collateral. The position is zeroed out.
      const { lenderContract, b1, liquidator } = await crashedPosition();
      await lenderContract.connect(liquidator).liquidate(b1.address, { value: ethers.parseEther("1.2") });
      const [, borrowed] = await lenderContract.getPosition(b1.address);
      expect(borrowed).to.equal(0);
    });
  });

  describe("admin", () => {
    it("owner updates tier LTV", async () => {
      const { lenderContract, owner } = await setup();
      await lenderContract.connect(owner).setTierLTV(1, 8500);
      expect(await lenderContract.tierMaxLTV(1)).to.equal(8500);
    });

    it("rejects LTV above 95% hard cap", async () => {
      const { lenderContract, owner } = await setup();
      await expect(lenderContract.connect(owner).setTierLTV(1, 9600))
        .to.be.revertedWithCustomError(lenderContract, "LTVTooHigh");
    });

    it("non-owner cannot setTierLTV", async () => {
      const { lenderContract, rando } = await setup();
      await expect(lenderContract.connect(rando).setTierLTV(1, 8000))
        .to.be.revertedWithCustomError(lenderContract, "OwnableUnauthorizedAccount");
    });

    it("pause blocks borrowing", async () => {
      const { lenderContract, owner, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(owner).pause();
      await expect(lenderContract.connect(b1).borrow(ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(lenderContract, "EnforcedPause");
    });
  });

  describe("view functions", () => {
    it("getHealthFactor returns max for no position", async () => {
      const { lenderContract, rando } = await setup();
      expect(await lenderContract.getHealthFactor(rando.address)).to.equal(ethers.MaxUint256);
    });

    it("getMaxBorrow returns 0 for no attestation", async () => {
      const { lenderContract, rando } = await setup();
      const [max] = await lenderContract.getMaxBorrow(rando.address);
      expect(max).to.equal(0);
    });

    it("getMaxBorrow returns ~0.9 ETH for tier 1 with 1 ETH collateral", async () => {
      const { lenderContract, b1, mint, depositCollateral } = await setup();
      await mint(b1, 1);
      await depositCollateral(b1);
      const [max, tier] = await lenderContract.getMaxBorrow(b1.address);
      expect(tier).to.equal(1);
      expect(max).to.be.closeTo(ethers.parseEther("0.9"), ethers.parseEther("0.001"));
    });

    it("getPoolStats reflects utilisation", async () => {
      const { lenderContract, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool();
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      const [liquidity, borrowed, available, utilBps] = await lenderContract.getPoolStats();
      expect(liquidity).to.equal(ONE_ETH);
      expect(borrowed).to.equal(ethers.parseEther("0.5"));
      expect(available).to.equal(ethers.parseEther("0.5"));
      expect(utilBps).to.equal(5000);
    });

    it("health factor drops when price crashes", async () => {
      const { lenderContract, priceFeed, b1, mint, seedPool, depositCollateral } = await setup();
      await seedPool(ethers.parseEther("5"));
      await mint(b1, 1);
      await depositCollateral(b1);
      await lenderContract.connect(b1).borrow(ethers.parseEther("0.5"));
      const hfBefore = await lenderContract.getHealthFactor(b1.address);
      await priceFeed.setPrice(ETH_PRICE / 2);
      const hfAfter = await lenderContract.getHealthFactor(b1.address);
      expect(hfAfter).to.be.lt(hfBefore);
    });
  });
});
