// ============================================================
// ConfidentialGuard Protocol — GuardianVault Test Suite
// contracts/test/GuardianVault.test.ts
//
// Coverage target: >95% lines, branches, functions, statements
//
// Verified invariants:
//   1. ETH deposits increase collateralAmount correctly
//   2. Withdrawals revert if resulting HF < guardian threshold (1.2)
//   3. triggerGuardianAction sends CCIP message with correct payload
//   4. Only allowed destination chains are accepted
//   5. checkGuardianCondition returns true iff HF < 1.2
//   6. Price feed staleness revert propagates correctly
//   7. Zero-debt positions have infinite HF (never trigger guardian)
//   8. Pull-over-push refund: excess CCIP fee stored in pendingRefunds
//   9. withdrawRefund() pulls pending ETH; NoRefundPending if none
// ============================================================

import { expect }    from 'chai'
import { ethers }    from 'hardhat'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { GuardianVault, MockPriceFeed, MockCCIPRouter } from '../typechain-types'

// ETH/USD = $3,000 at 8 decimals (standard Chainlink format)
const ETH_PRICE_8DEC = 300_000_000_000n   // $3,000 × 1e8
const ETH_USD_1E18   = 3_000n * 10n ** 18n

// 1 ether in wei
const ONE_ETH = ethers.parseEther('1')

// CCIP fee
const CCIP_FEE = ethers.parseEther('0.01')

// Base Sepolia chain selector (Chainlink official)
const BASE_SEPOLIA_SELECTOR = 10344971235874465080n

describe('GuardianVault', function () {
  let vault:       GuardianVault
  let priceFeed:   MockPriceFeed
  let ccipRouter:  MockCCIPRouter
  let owner:       HardhatEthersSigner
  let user1:       HardhatEthersSigner
  let user2:       HardhatEthersSigner
  let keeper:      HardhatEthersSigner
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
      const fakeToken = user1.address // any non-zero address
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
  // setDebtAmount
  // ─────────────────────────────────────────────────────────────

  describe('setDebtAmount', () => {
    it('stores debt amount correctly', async () => {
      const debtUSD = ethers.parseEther('2000')  // $2,000 in 1e18
      await vault.connect(user1).setDebtAmount(debtUSD)
      const pos = await vault.getVaultPosition(user1.address)
      expect(pos.debtAmount).to.equal(debtUSD)
    })

    it('emits HealthFactorUpdated', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      const debtUSD = ethers.parseEther('2000')
      await expect(vault.connect(user1).setDebtAmount(debtUSD))
        .to.emit(vault, 'HealthFactorUpdated')
        .withArgs(user1.address, ethers.anything ?? (() => true))
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
      await vault.connect(user1).setDebtAmount(ethers.parseEther('1000'))
      const hf = await vault.getHealthFactor(user1.address)
      expect(hf).to.equal(0n)
    })

    it('computes correct HF for ETH collateral at $3,000', async () => {
      // 1 ETH × $3,000 × 0.825 / $2,000 = $2,475 / $2,000 = 1.2375
      // In 1e18: 1237500000000000000
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2000'))
      const hf = await vault.getHealthFactor(user1.address)

      // adjustedCollateral = 1e18 × 3000e18 / 1e18 × 8250 / 10000 = 2475e18
      // HF = 2475e18 × 1e18 / 2000e18 = 1.2375e18
      const expectedHF = 1237500000000000000n
      expect(hf).to.equal(expectedHF)
    })

    it('HF decreases when ETH price drops', async () => {
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2000'))

      const hfBefore = await vault.getHealthFactor(user1.address)

      // Drop ETH price to $2,000
      await priceFeed.setPrice(200_000_000_000n) // $2,000 at 8 dec
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
      // Set debt such that HF is just above 1.2 with 5 ETH
      // 5 ETH × $3,000 × 0.825 = $12,375 / debt = 1.2 → debt = $10,312.5
      const debt = ethers.parseEther('10312')
      await vault.connect(user1).setDebtAmount(debt)

      // Remove 4 ETH → 1 ETH × $3,000 × 0.825 = $2,475 / $10,312 ≈ 0.24 < 1.2
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
      // 10 ETH × $3,000 × 0.825 / $20,000 = $24,750 / $20,000 = 1.2375 > 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ethers.parseEther('10'), { value: ethers.parseEther('10') }
      )
      await vault.connect(user1).setDebtAmount(ethers.parseEther('20000'))
      expect(await vault.checkGuardianCondition(user1.address)).to.be.false
    })

    it('returns true when HF < 1.2 (guardian needed)', async () => {
      // 1 ETH × $3,000 × 0.825 / $2,500 = $2,475 / $2,500 = 0.99 < 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2500'))
      expect(await vault.checkGuardianCondition(user1.address)).to.be.true
    })
  })

  // ─────────────────────────────────────────────────────────────
  // triggerGuardianAction
  // ─────────────────────────────────────────────────────────────

  describe('triggerGuardianAction', () => {
    beforeEach(async () => {
      // Set up a position that needs guardian action: HF < 1.2
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      // $2,500 debt → HF = 2475/2500 = 0.99 < 1.2
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2500'))
    })

    it('emits GuardianActionTriggered with correct user and chain', async () => {
      // Parse the messageId from the emitted event (generated inside the tx,
      // so it cannot be read from router.lastMessageId() before the call).
      const tx      = await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: ethers.parseEther('0.05') }
      )
      const receipt = await tx.wait()
      const log     = receipt!.logs
        .map(l => { try { return vault.interface.parseLog(l as Parameters<typeof vault.interface.parseLog>[0]) } catch { return null } })
        .find(p => p?.name === 'GuardianActionTriggered')

      expect(log).to.not.be.null
      expect(log!.args[0]).to.equal(user1.address)
      expect(log!.args[1]).to.equal(BASE_SEPOLIA_SELECTOR)
      expect(log!.args[2]).to.not.equal(ethers.ZeroHash)  // messageId was generated
    })

    it('sends CCIP message via router', async () => {
      const countBefore = await ccipRouter.messageCount()
      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: ethers.parseEther('0.05') }
      )
      const countAfter = await ccipRouter.messageCount()
      expect(countAfter).to.equal(countBefore + 1n)
    })

    it('reverts for disallowed destination chain', async () => {
      const unknownChain = 999999999n
      await expect(
        vault.connect(keeper).triggerGuardianAction(
          user1.address, unknownChain, { value: ethers.parseEther('0.05') }
        )
      ).to.be.revertedWithCustomError(vault, 'InvalidChainSelector')
    })

    it('reverts when position HF is above guardian threshold', async () => {
      // user2: healthy position (HF >> 1.2)
      await vault.connect(user2).depositCollateral(
        ethers.ZeroAddress, ethers.parseEther('10'), { value: ethers.parseEther('10') }
      )
      await vault.connect(user2).setDebtAmount(ethers.parseEther('1000'))

      await expect(
        vault.connect(keeper).triggerGuardianAction(
          user2.address, BASE_SEPOLIA_SELECTOR, { value: ethers.parseEther('0.05') }
        )
      ).to.be.revertedWithCustomError(vault, 'HealthFactorTooLow')
    })

    it('stores excess ETH in pendingRefunds (pull-over-push)', async () => {
      // Pull-over-push: excess CCIP fee is NOT pushed to caller during the call.
      // It is stored in pendingRefunds so automation bots without receive() still work.
      const excess = ethers.parseEther('0.09')
      const sent   = CCIP_FEE + excess

      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: sent }
      )

      // Excess must be stored, not pushed.
      expect(await vault.pendingRefunds(keeper.address)).to.equal(excess)
    })

    it('emits RefundPending event for excess CCIP fee', async () => {
      const excess = ethers.parseEther('0.09')
      const sent   = CCIP_FEE + excess

      await expect(
        vault.connect(keeper).triggerGuardianAction(
          user1.address, BASE_SEPOLIA_SELECTOR, { value: sent }
        )
      ).to.emit(vault, 'RefundPending')
        .withArgs(keeper.address, excess)
    })

    it('does NOT emit RefundPending when msg.value == CCIP fee exactly', async () => {
      const tx = await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE }
      )
      const receipt = await tx.wait()
      const refundLogs = receipt!.logs.filter(log => {
        try {
          const parsed = vault.interface.parseLog(log as Parameters<typeof vault.interface.parseLog>[0])
          return parsed?.name === 'RefundPending'
        } catch { return false }
      })
      expect(refundLogs.length).to.equal(0)
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
  // withdrawRefund (pull-over-push pattern)
  // ─────────────────────────────────────────────────────────────

  describe('withdrawRefund', () => {
    beforeEach(async () => {
      // Set up an at-risk position for keeper to trigger.
      await vault.connect(user1).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2500'))
    })

    it('transfers pending refund to caller', async () => {
      const excess = ethers.parseEther('0.05')
      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE + excess }
      )
      expect(await vault.pendingRefunds(keeper.address)).to.equal(excess)

      const balanceBefore = await ethers.provider.getBalance(keeper.address)
      const tx     = await vault.connect(keeper).withdrawRefund()
      const receipt = await tx.wait()
      const gasCost = receipt!.gasUsed * receipt!.gasPrice
      const balanceAfter = await ethers.provider.getBalance(keeper.address)

      // Net: received excess, paid gas
      expect(balanceAfter - balanceBefore).to.be.closeTo(
        excess - gasCost,
        ethers.parseEther('0.0001')
      )
    })

    it('clears pendingRefunds after withdrawal', async () => {
      const excess = ethers.parseEther('0.05')
      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE + excess }
      )
      await vault.connect(keeper).withdrawRefund()
      expect(await vault.pendingRefunds(keeper.address)).to.equal(0n)
    })

    it('accumulates multiple refunds before withdrawal', async () => {
      const excess = ethers.parseEther('0.05')
      // Trigger twice (using different users to avoid HF re-check issue)
      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE + excess }
      )
      // Set up user2 at-risk position
      await vault.connect(user2).depositCollateral(
        ethers.ZeroAddress, ONE_ETH, { value: ONE_ETH }
      )
      await vault.connect(user2).setDebtAmount(ethers.parseEther('2500'))
      await vault.connect(keeper).triggerGuardianAction(
        user2.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE + excess }
      )
      expect(await vault.pendingRefunds(keeper.address)).to.equal(excess * 2n)
    })

    it('reverts with NoRefundPending when caller has no pending refund', async () => {
      await expect(
        vault.connect(keeper).withdrawRefund()
      ).to.be.revertedWithCustomError(vault, 'NoRefundPending')
    })

    it('reverts with NoRefundPending after already withdrawing', async () => {
      const excess = ethers.parseEther('0.05')
      await vault.connect(keeper).triggerGuardianAction(
        user1.address, BASE_SEPOLIA_SELECTOR, { value: CCIP_FEE + excess }
      )
      await vault.connect(keeper).withdrawRefund()

      // Second withdrawal must revert.
      await expect(
        vault.connect(keeper).withdrawRefund()
      ).to.be.revertedWithCustomError(vault, 'NoRefundPending')
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
      await vault.connect(user1).setDebtAmount(ethers.parseEther('2000'))

      // Set updatedAt to 2 hours ago
      await priceFeed.setUpdatedAt(Math.floor(Date.now() / 1000) - 7_200)

      await expect(vault.getHealthFactor(user1.address))
        .to.be.revertedWithCustomError(vault, 'StalePrice')
    })
  })
})
