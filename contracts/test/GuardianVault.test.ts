// ============================================================
// ConfidentialGuard Protocol — GuardianVault Test Suite
// contracts/test/GuardianVault.test.ts
//
// Coverage target: >95% lines, branches, functions, statements
//
// Verified invariants:
//   1.  ETH deposits increase collateralAmount correctly
//   2.  Withdrawals revert if resulting HF < guardian threshold (1.2)
//   3.  triggerGuardianAction sends CCIP message via guardianPool (no msg.value)
//   4.  Only allowed destination chains are accepted
//   5.  checkGuardianCondition returns true iff HF < 1.2
//   6.  Price feed staleness revert propagates correctly
//   7.  Zero-debt positions have infinite HF (never trigger guardian)
//   8.  setDebtAmount is only callable by trusted lenders (onlyTrustedLender)
//   9.  fundGuardianPool accumulates ETH; InsufficientGuardianPool if underfunded
//   10. triggerGuardianAction has a per-user 5-minute cooldown
//   11. PositionHealthy error if position is healthy when guardian triggered
// ============================================================

import { expect }    from 'chai'
import { ethers }    from 'hardhat'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { GuardianVault, MockPriceFeed, MockCCIPRouter } from '../typechain-types'

// ETH/USD = $3,000 at 8 decimals (standard Chainlink format)
const ETH_PRICE_8DEC = 300_000_000_000n   // $3,000 × 1e8

// 1 ether in wei
const ONE_ETH = ethers.parseEther('1')

// CCIP fee charged by the mock router
const CCIP_FEE = ethers.parseEther('0.01')

// Pool pre-funded for CCIP fees
const POOL_FUND = ethers.parseEther('1')

// 5 minutes in seconds (GUARDIAN_COOLDOWN constant)
const FIVE_MINUTES = 300

// Base Sepolia chain selector (Chainlink official)
const BASE_SEPOLIA_SELECTOR = 10344971235874465080n

describe('GuardianVault', function () {
  let vault:       GuardianVault
  let priceFeed:   MockPriceFeed
  let ccipRouter:  MockCCIPRouter
  let owner:       HardhatEthersSigner
  let user1:       HardhatEthersSigner
  let user2:       HardhatEthersSigner
  let keeper:      HardhatEthersSigner   // registered as trustedLender in beforeEach
  let receiver:    HardhatEthersSigner

  beforeEach(async function () {
    ;[owner, user1, user2, keeper, receiver] = await ethers.getSigners()

    // Deploy mocks
    const FeedFactory   = await ethers.getContractFactory('MockPriceFeed')
    const RouterFactory = await ethers.getContractFactory('MockCCIPRouter')

    priceFeed  = await FeedFactory.deploy(ETH_PRICE_8DEC, 8, 'ETH / USD')
    ccipRouter = await RouterFactory.deploy(CCIP_FEE)

    await priceFeed.waitForDeployment()
    await ccipRouter.waitForDeployment()

    // Deploy vault
    const VaultFactory = await ethers.getContractFactory('GuardianVault')
    vault = await VaultFactory.deploy(
      await ccipRouter.getAddress(),
      await priceFeed.getAddress(),
      owner.address
    )
    await vault.waitForDeployment()

    // Configure allowed destination chain
    await vault.connect(owner).setDestinationChain(
      BASE_SEPOLIA_SELECTOR,
      true,
      receiver.address
    )

    // Register keeper as trusted lender — required for setDebtAmount
    await vault.connect(owner).setTrustedLender(keeper.address, true)

    // Pre-fund guardian pool so triggerGuardianAction doesn't need msg.value
    await vault.connect(owner).fundGuardianPool({ value: POOL_FUND })
  })

  // ─────────────────────────────────────────────────────────────
  // Deployment
  // ─────────────────────────────────────────────────────────────

  describe('Deployment', () => {
    it('sets ccipRouter correctly', async () => {
      expect(await vault.ccipRouter()).to.equal(await ccipRouter.getAddress())
    })

    it('sets ethUsdFeed correctly', async () => {
      expect(await vault.ethUsdFeed()).to.equal(await priceFeed.getAddress())
    })

    it('sets owner correctly', async () => {
      expect(await vault.owner()).to.equal(owner.address)
    })

    it('reverts if ccipRouter is zero address', async () => {
      const factory = await ethers.getContractFactory('GuardianVault')
      await expect(
        factory.deploy(ethers.ZeroAddress, await priceFeed.getAddress(), owner.address)
      ).to.be.revertedWithCustomError(vault, 'UnauthorizedCaller')
    })

    it('reverts if ethUsdFeed is zero address', async () => {
      const factory = await ethers.getContractFactory('GuardianVault')
      await expect(
        factory.deploy(await ccipRouter.getAddress(), ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(vault, 'UnauthorizedCaller')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // fundGuardianPool (admin)
  // ─────────────────────────────────────────────────────────────

  describe('fundGuardianPool', () => {
    it('increases guardianPool balance', async () => {
      const before = await vault.guardianPool()
      await vault.connect(owner).fundGuardianPool({ value: ONE_ETH })
      expect(await vault.guardianPool()).to.equal(before + ONE_ETH)
    })

    it('emits GuardianPoolFunded', async () => {
      await expect(vault.connect(owner).fundGuardianPool({ value: ONE_ETH }))
        .to.emit(vault, 'GuardianPoolFunded')
        .withArgs(ONE_ETH)
    })

    it('reverts for non-owner', async () => {
      await expect(
        vault.connect(user1).fundGuardianPool({ value: ONE_ETH })
      ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount')
    })

    it('reverts when pool has insufficient balance for CCIP fee', async () => {
      // Deploy a fresh vault with empty pool
      const VaultFactory = await ethers.getContractFactory('GuardianVault')
      const emptyVault = await VaultFactory.deploy(
        await ccipRouter.getAddress(),
        await priceFeed.getAddress(),
        owner.address
      )
      await emptyVault.waitForDeployment()
      await emptyVault.connect(owner).setDestinationChain(BASE_SEPOLIA_SELECTOR, true, receiver.address)
      await emptyVault.connect(owner).setTrustedLender(keeper.address, true)

      // Set up at-risk position
      await emptyVault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await emptyVault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2500'))

      // Pool is empty — should revert
      await expect(
        emptyVault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      ).to.be.revertedWithCustomError(emptyVault, 'InsufficientGuardianPool')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // setTrustedLender (admin)
  // ─────────────────────────────────────────────────────────────

  describe('setTrustedLender', () => {
    it('registers a trusted lender', async () => {
      await vault.connect(owner).setTrustedLender(user2.address, true)
      expect(await vault.trustedLenders(user2.address)).to.be.true
    })

    it('revokes a trusted lender', async () => {
      await vault.connect(owner).setTrustedLender(keeper.address, false)
      expect(await vault.trustedLenders(keeper.address)).to.be.false
    })

    it('emits TrustedLenderUpdated', async () => {
      await expect(vault.connect(owner).setTrustedLender(user2.address, true))
        .to.emit(vault, 'TrustedLenderUpdated')
        .withArgs(user2.address, true)
    })

    it('reverts for non-owner', async () => {
      await expect(
        vault.connect(user1).setTrustedLender(user2.address, true)
      ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // depositCollateral
  // ─────────────────────────────────────────────────────────────

  describe('depositCollateral', () => {
    it('accepts ETH deposits', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      const pos = await vault.getVaultPosition(user1.address)
      expect(pos.collateralAmount).to.equal(ONE_ETH)
    })

    it('accumulates multiple deposits', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      const pos = await vault.getVaultPosition(user1.address)
      expect(pos.collateralAmount).to.equal(ONE_ETH * 2n)
    })

    it('emits CollateralDeposited', async () => {
      await expect(
        vault.connect(user1).depositCollateral(
          ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
        )
      ).to.emit(vault, 'CollateralDeposited')
        .withArgs(user1.address, ethers.ZeroAddress, ONE_ETH)
    })

    it('reverts for non-ETH token (ERC20 not supported)', async () => {
      const fakeToken = user1.address
      await expect(
        vault.connect(user1).depositCollateral(fakeToken, ONE_ETH, { value: ONE_ETH })
      ).to.be.revertedWithCustomError(vault, 'UnsupportedToken')
        .withArgs(fakeToken)
    })

    it('reverts when msg.value != amount', async () => {
      await expect(
        vault.connect(user1).depositCollateral(
          ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH / 2n }
        )
      ).to.be.revertedWithCustomError(vault, 'EthAmountMismatch')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // setDebtAmount (onlyTrustedLender)
  // ─────────────────────────────────────────────────────────────

  describe('setDebtAmount', () => {
    it('stores debt amount correctly when called by trusted lender', async () => {
      const debtUSD = ethers.parseEther('2000')
      await vault.connect(keeper).setDebtAmount(user1.address, debtUSD)
      const pos = await vault.getVaultPosition(user1.address)
      expect(pos.debtAmount).to.equal(debtUSD)
    })

    it('emits HealthFactorUpdated', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      const debtUSD = ethers.parseEther('2000')
      await expect(vault.connect(keeper).setDebtAmount(user1.address, debtUSD))
        .to.emit(vault, 'HealthFactorUpdated')
        .withArgs(user1.address, 1237500000000000000n)  // 1 ETH @ $3000 × 0.825 / $2000 = 1.2375
    })

    it('reverts when called by untrusted address', async () => {
      await expect(
        vault.connect(user1).setDebtAmount(user1.address, ethers.parseEther('1000'))
      ).to.be.revertedWithCustomError(vault, 'UnauthorizedCaller')
    })

    it('reverts when called by owner who is not a trusted lender', async () => {
      await expect(
        vault.connect(owner).setDebtAmount(user1.address, ethers.parseEther('1000'))
      ).to.be.revertedWithCustomError(vault, 'UnauthorizedCaller')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // getHealthFactor
  // ─────────────────────────────────────────────────────────────

  describe('getHealthFactor', () => {
    it('returns max uint256 for zero-debt position', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      const hf = await vault.getHealthFactor(user1.address)
      expect(hf).to.equal(ethers.MaxUint256)
    })

    it('returns 0 for zero-collateral position with debt', async () => {
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('1000'))
      const hf = await vault.getHealthFactor(user1.address)
      expect(hf).to.equal(0n)
    })

    it('computes correct HF for ETH collateral at $3,000', async () => {
      // 1 ETH × $3,000 × 0.825 / $2,000 = $2,475 / $2,000 = 1.2375
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2000'))
      const hf = await vault.getHealthFactor(user1.address)
      expect(hf).to.equal(1237500000000000000n)
    })

    it('HF decreases when ETH price drops', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2000'))

      const hfBefore = await vault.getHealthFactor(user1.address)

      // Drop ETH price to $2,000
      await priceFeed.setPrice(200_000_000_000n)
      const hfAfter = await vault.getHealthFactor(user1.address)

      expect(hfAfter).to.be.lessThan(hfBefore)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // withdrawCollateral
  // ─────────────────────────────────────────────────────────────

  describe('withdrawCollateral', () => {
    beforeEach(async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ethers.parseEther('5'), { value: ethers.parseEther('5') }
      )
    })

    it('withdraws ETH and reduces collateralAmount', async () => {
      await vault.connect(user1).withdrawCollateral(ethers.ZeroAddress, ONE_ETH)
      const pos = await vault.getVaultPosition(user1.address)
      expect(pos.collateralAmount).to.equal(ethers.parseEther('4'))
    })

    it('emits CollateralWithdrawn', async () => {
      await expect(vault.connect(user1).withdrawCollateral(ethers.ZeroAddress, ONE_ETH))
        .to.emit(vault, 'CollateralWithdrawn')
        .withArgs(user1.address, ethers.ZeroAddress, ONE_ETH)
    })

    it('reverts if withdrawal exceeds balance', async () => {
      await expect(
        vault.connect(user1).withdrawCollateral(ethers.ZeroAddress, ethers.parseEther('10'))
      ).to.be.revertedWithCustomError(vault, 'InsufficientCollateral')
    })

    it('reverts if withdrawal would drop HF below guardian threshold', async () => {
      // 5 ETH × $3,000 × 0.825 / $10,312 ≈ 1.2 — just above threshold with 5 ETH
      const debt = ethers.parseEther('10312')
      await vault.connect(keeper).setDebtAmount(user1.address, debt)

      // Remove 4 ETH → HF ≈ 0.24 < 1.2
      await expect(
        vault.connect(user1).withdrawCollateral(ethers.ZeroAddress, ethers.parseEther('4'))
      ).to.be.revertedWithCustomError(vault, 'HealthFactorTooLow')
    })

    it('allows full withdrawal when debt is zero', async () => {
      await expect(
        vault.connect(user1).withdrawCollateral(ethers.ZeroAddress, ethers.parseEther('5'))
      ).to.not.be.reverted
    })

    it('reverts for unsupported token', async () => {
      await expect(
        vault.connect(user1).withdrawCollateral(user1.address, ONE_ETH)
      ).to.be.revertedWithCustomError(vault, 'UnsupportedToken')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // checkGuardianCondition
  // ─────────────────────────────────────────────────────────────

  describe('checkGuardianCondition', () => {
    it('returns false when debt is zero', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      expect(await vault.checkGuardianCondition(user1.address)).to.be.false
    })

    it('returns false when HF >= 1.2 (healthy position)', async () => {
      // 10 ETH × $3,000 × 0.825 / $20,000 = 1.2375 > 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ethers.parseEther('10'), { value: ethers.parseEther('10') }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('20000'))
      expect(await vault.checkGuardianCondition(user1.address)).to.be.false
    })

    it('returns true when HF < 1.2 (guardian needed)', async () => {
      // 1 ETH × $3,000 × 0.825 / $2,500 = 0.99 < 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2500'))
      expect(await vault.checkGuardianCondition(user1.address)).to.be.true
    })
  })

  // ─────────────────────────────────────────────────────────────
  // triggerGuardianAction
  // ─────────────────────────────────────────────────────────────

  describe('triggerGuardianAction', () => {
    beforeEach(async () => {
      // Set up at-risk position: HF = 0.99 < 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2500'))
    })

    it('emits GuardianActionTriggered with correct user and chain', async () => {
      const tx      = await vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      const receipt = await tx.wait()
      const log     = receipt!.logs
        .map(l => { try { return vault.interface.parseLog(l as Parameters<typeof vault.interface.parseLog>[0]) } catch { return null } })
        .find(p => p?.name === 'GuardianActionTriggered')

      expect(log).to.not.be.null
      expect(log!.args[0]).to.equal(user1.address)
      expect(log!.args[1]).to.equal(BASE_SEPOLIA_SELECTOR)
      expect(log!.args[2]).to.not.equal(ethers.ZeroHash)
    })

    it('sends CCIP message via router', async () => {
      const countBefore = await ccipRouter.messageCount()
      await vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      const countAfter = await ccipRouter.messageCount()
      expect(countAfter).to.equal(countBefore + 1n)
    })

    it('deducts CCIP fee from guardianPool', async () => {
      const poolBefore = await vault.guardianPool()
      await vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      const poolAfter = await vault.guardianPool()
      expect(poolBefore - poolAfter).to.equal(CCIP_FEE)
    })

    it('reverts for disallowed destination chain', async () => {
      const unknownChain = 999999999n
      await expect(
        vault.connect(keeper).triggerGuardianAction(user1.address, unknownChain)
      ).to.be.revertedWithCustomError(vault, 'InvalidChainSelector')
    })

    it('reverts with PositionHealthy when HF is above guardian threshold', async () => {
      // user2: healthy (HF >> 1.2)
      await vault.connect(user2).depositCollateral(
        ethers.ZeroAddress, ethers.parseEther('10'), { value: ethers.parseEther('10') }
      )
      await vault.connect(keeper).setDebtAmount(user2.address, ethers.parseEther('1000'))

      await expect(
        vault.connect(keeper).triggerGuardianAction(user2.address, BASE_SEPOLIA_SELECTOR)
      ).to.be.revertedWithCustomError(vault, 'PositionHealthy')
    })

    it('reverts with GuardianCooldownActive if triggered again within 5 minutes', async () => {
      // First trigger succeeds
      await vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)

      // Immediate re-trigger: cooldown not elapsed
      await expect(
        vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      ).to.be.revertedWithCustomError(vault, 'GuardianCooldownActive')
    })

    it('allows re-trigger after cooldown elapses', async () => {
      await vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)

      // Advance 5 minutes
      await ethers.provider.send('evm_increaseTime', [FIVE_MINUTES])
      await ethers.provider.send('evm_mine', [])

      await expect(
        vault.connect(keeper).triggerGuardianAction(user1.address, BASE_SEPOLIA_SELECTOR)
      ).to.not.be.reverted
    })
  })

  // ─────────────────────────────────────────────────────────────
  // setDestinationChain (admin)
  // ─────────────────────────────────────────────────────────────

  describe('setDestinationChain', () => {
    it('allows owner to add destination chain', async () => {
      const newChain = 12345n
      await vault.connect(owner).setDestinationChain(newChain, true, receiver.address)
      expect(await vault.allowedDestinationChains(newChain)).to.be.true
    })

    it('allows owner to remove destination chain', async () => {
      await vault.connect(owner).setDestinationChain(BASE_SEPOLIA_SELECTOR, false, ethers.ZeroAddress)
      expect(await vault.allowedDestinationChains(BASE_SEPOLIA_SELECTOR)).to.be.false
    })

    it('emits DestinationChainUpdated', async () => {
      await expect(
        vault.connect(owner).setDestinationChain(BASE_SEPOLIA_SELECTOR, true, receiver.address)
      ).to.emit(vault, 'DestinationChainUpdated')
        .withArgs(BASE_SEPOLIA_SELECTOR, true, receiver.address)
    })

    it('reverts for non-owner', async () => {
      await expect(
        vault.connect(user1).setDestinationChain(BASE_SEPOLIA_SELECTOR, true, receiver.address)
      ).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Stale price feed
  // ─────────────────────────────────────────────────────────────

  describe('Stale price feed', () => {
    it('reverts getHealthFactor when price is stale (> 1 hour)', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(keeper).setDebtAmount(user1.address, ethers.parseEther('2000'))

      // Set updatedAt to 2 hours ago
      await priceFeed.setUpdatedAt(Math.floor(Date.now() / 1000) - 7_200)

      await expect(vault.getHealthFactor(user1.address))
        .to.be.revertedWithCustomError(vault, 'StalePrice')
    })
  })
})
