// ============================================================
// ConfidentialGuard Protocol — CCIPGuardianReceiver Test Suite
// contracts/test/CCIPGuardianReceiver.test.ts
//
// Coverage target: >95% lines, branches, functions, statements
//
// Verified invariants:
//   1. Only CCIP router can call ccipReceive
//   2. Only allowed source chains are processed
//   3. Only registered sender on source chain is accepted
//   4. GuardianAction is stored correctly with executed=true
//   5. GuardianActionReceived event emitted with correct args
//   6. setSourceChain: only owner, emits SourceChainUpdated
// ============================================================

import { expect }    from 'chai'
import { ethers }    from 'hardhat'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { CCIPGuardianReceiver, MockCCIPRouter } from '../typechain-types'

// Sepolia chain selector
const SEPOLIA_SELECTOR = 16015286601757825753n
// Test health factor: 0.99 × 1e18
const TEST_HF = 990_000_000_000_000_000n
// CCIP fee
const CCIP_FEE = ethers.parseEther('0.01')

describe('CCIPGuardianReceiver', function () {
  let receiver:   CCIPGuardianReceiver
  let router:     MockCCIPRouter
  let owner:      HardhatEthersSigner
  let vault:      HardhatEthersSigner   // simulates GuardianVault on source chain
  let user1:      HardhatEthersSigner
  let attacker:   HardhatEthersSigner

  beforeEach(async function () {
    ;[owner, vault, user1, attacker] = await ethers.getSigners()

    // Deploy mock router (acts as CCIP router on destination chain)
    const RouterFactory = await ethers.getContractFactory('MockCCIPRouter')
    router = await RouterFactory.deploy(CCIP_FEE)
    await router.waitForDeployment()

    // Deploy receiver
    const ReceiverFactory = await ethers.getContractFactory('CCIPGuardianReceiver')
    receiver = await ReceiverFactory.deploy(
      await router.getAddress(),
      owner.address
    )
    await receiver.waitForDeployment()

    // Configure allowed source chain
    await receiver.connect(owner).setSourceChain(
      SEPOLIA_SELECTOR,
      true,
      vault.address
    )
  })

  // ─────────────────────────────────────────────────────────────
  // Deployment
  // ─────────────────────────────────────────────────────────────

  describe('Deployment', () => {
    it('sets owner correctly', async () => {
      expect(await receiver.owner()).to.equal(owner.address)
    })

    it('reverts if ccipRouter is address(0)', async () => {
      const factory = await ethers.getContractFactory('CCIPGuardianReceiver')
      await expect(
        factory.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(receiver, 'ZeroAddress')
    })

    it('reverts if owner is address(0)', async () => {
      // OZ 5.x Ownable validates in base constructor → OwnableInvalidOwner fires first.
      const factory = await ethers.getContractFactory('CCIPGuardianReceiver')
      await expect(
        factory.deploy(await router.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(receiver, 'OwnableInvalidOwner')
        .withArgs(ethers.ZeroAddress)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // setSourceChain
  // ─────────────────────────────────────────────────────────────

  describe('setSourceChain', () => {
    it('adds allowed source chain', async () => {
      expect(await receiver.isAllowedSourceChain(SEPOLIA_SELECTOR)).to.be.true
      expect(await receiver.allowedSenders(SEPOLIA_SELECTOR)).to.equal(vault.address)
    })

    it('removes source chain', async () => {
      await receiver.connect(owner).setSourceChain(SEPOLIA_SELECTOR, false, ethers.ZeroAddress)
      expect(await receiver.isAllowedSourceChain(SEPOLIA_SELECTOR)).to.be.false
    })

    it('emits SourceChainUpdated', async () => {
      await expect(
        receiver.connect(owner).setSourceChain(SEPOLIA_SELECTOR, true, vault.address)
      ).to.emit(receiver, 'SourceChainUpdated')
        .withArgs(SEPOLIA_SELECTOR, true, vault.address)
    })

    it('reverts for non-owner', async () => {
      await expect(
        receiver.connect(attacker).setSourceChain(SEPOLIA_SELECTOR, true, vault.address)
      ).to.be.revertedWithCustomError(receiver, 'OwnableUnauthorizedAccount')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // ccipReceive (via MockCCIPRouter.deliver)
  // ─────────────────────────────────────────────────────────────

  describe('ccipReceive', () => {
    const messageData = () => ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [user1.address, TEST_HF]
    )

    it('processes a valid CCIP message and stores guardian action', async () => {
      await router.deliver(
        await receiver.getAddress(),
        SEPOLIA_SELECTOR,
        vault.address,
        messageData()
      )

      const messageId = await router.lastMessageId()
      const action    = await receiver.getGuardianAction(messageId)

      expect(action.user).to.equal(user1.address)
      expect(action.healthFactor).to.equal(TEST_HF)
      expect(action.sourceChain).to.equal(SEPOLIA_SELECTOR)
      expect(action.executed).to.be.true
    })

    it('emits GuardianActionReceived with correct args', async () => {
      await expect(
        router.deliver(
          await receiver.getAddress(),
          SEPOLIA_SELECTOR,
          vault.address,
          messageData()
        )
      ).to.emit(receiver, 'GuardianActionReceived')
        .withArgs(
          await router.lastMessageId(),  // messageId (may be 0x00 before delivery)
          SEPOLIA_SELECTOR,
          user1.address,
          TEST_HF
        )
    })

    it('reverts for unauthorized source chain', async () => {
      const unknownChain = 9999999n
      await expect(
        router.deliver(
          await receiver.getAddress(),
          unknownChain,
          vault.address,
          messageData()
        )
      ).to.be.revertedWithCustomError(receiver, 'UnauthorizedSourceChain')
        .withArgs(unknownChain)
    })

    it('reverts for unauthorized sender on a valid source chain', async () => {
      await expect(
        router.deliver(
          await receiver.getAddress(),
          SEPOLIA_SELECTOR,
          attacker.address,   // not the registered vault
          messageData()
        )
      ).to.be.revertedWithCustomError(receiver, 'UnauthorizedSender')
        .withArgs(attacker.address)
    })

    it('reverts when called directly (not via router)', async () => {
      // ccipReceive is protected by onlyRouter — only i_ccipRouter can call it.
      // Attacker calling directly gets InvalidRouter revert.
      await expect(
        receiver.connect(attacker).ccipReceive({
          messageId:           ethers.ZeroHash,
          sourceChainSelector: SEPOLIA_SELECTOR,
          sender:              ethers.AbiCoder.defaultAbiCoder().encode(['address'], [vault.address]),
          data:                messageData(),
          destTokenAmounts:    []
        })
      ).to.be.revertedWithCustomError(receiver, 'InvalidRouter')
        .withArgs(attacker.address)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // getGuardianAction
  // ─────────────────────────────────────────────────────────────

  describe('getGuardianAction', () => {
    it('returns empty action for unknown messageId', async () => {
      const action = await receiver.getGuardianAction(ethers.ZeroHash)
      expect(action.user).to.equal(ethers.ZeroAddress)
      expect(action.executed).to.be.false
    })
  })

  // ─────────────────────────────────────────────────────────────
  // isAllowedSourceChain
  // ─────────────────────────────────────────────────────────────

  describe('isAllowedSourceChain', () => {
    it('returns true for allowed chain', async () => {
      expect(await receiver.isAllowedSourceChain(SEPOLIA_SELECTOR)).to.be.true
    })

    it('returns false for unknown chain', async () => {
      expect(await receiver.isAllowedSourceChain(999n)).to.be.false
    })
  })
})
