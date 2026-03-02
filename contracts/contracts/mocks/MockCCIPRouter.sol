// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IRouterClient } from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client }        from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { IAny2EVMMessageReceiver } from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";

// ─────────────────────────────────────────────────────────────────────────────
// MockCCIPRouter — Minimal IRouterClient implementation for tests
//
// Allows tests to:
//   1. Set a configurable CCIP fee (setFee)
//   2. Capture sent messages (lastMessageId, lastMessage)
//   3. Simulate delivery by calling deliver() to invoke the receiver's _ccipReceive
//   4. Simulate fee that reverts (for negative test cases)
//
// NOT for production use.
// ─────────────────────────────────────────────────────────────────────────────
contract MockCCIPRouter is IRouterClient {

  // ── Storage ──────────────────────────────────────────────────────────────

  uint256 private _fee;
  bytes32 private _nextMessageId;
  bytes32 public  lastMessageId;
  Client.EVM2AnyMessage public lastMessage;
  uint64  public lastDestinationChain;
  uint256 public messageCount;

  // ── Events ───────────────────────────────────────────────────────────────

  event MessageSent(
    bytes32 indexed messageId,
    uint64  indexed destinationChain,
    bytes           data
  );

  // ── Constructor ──────────────────────────────────────────────────────────

  /// @param fee_ Default CCIP fee in wei returned by getFee.
  constructor(uint256 fee_) {
    _fee           = fee_;
    _nextMessageId = keccak256(abi.encodePacked("MockCCIPRouter", block.chainid));
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  /**
   * @notice Sets the fee returned by getFee.
   * @param fee_ New fee in wei.
   */
  function setFee(uint256 fee_) external {
    _fee = fee_;
  }

  /**
   * @notice Simulates message delivery to a CCIPReceiver.
   * @dev Call this in tests after ccipSend to exercise the receiver's _ccipReceive.
   * @param receiver    The CCIPReceiver contract to deliver to.
   * @param sourceChain Source chain selector to encode in the message.
   * @param sender      GuardianVault address on the source chain.
   * @param data        Message payload (abi.encode(user, healthFactor)).
   */
  function deliver(
    address receiver,
    uint64  sourceChain,
    address sender,
    bytes   memory data
  ) external {
    Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
      messageId:            lastMessageId,
      sourceChainSelector:  sourceChain,
      sender:               abi.encode(sender),
      data:                 data,
      destTokenAmounts:     new Client.EVMTokenAmount[](0)
    });

    IAny2EVMMessageReceiver(receiver).ccipReceive(message);
  }

  // ── IRouterClient implementation ─────────────────────────────────────────

  /**
   * @notice Returns whether a chain selector is supported.
   * @dev Mock always returns true (tests control chain validation at the
   *      contract level, not the router level).
   */
  function isChainSupported(uint64 /* destChainSelector */) external pure override returns (bool) {
    return true;
  }

  /**
   * @notice Returns the configured mock fee.
   */
  function getFee(
    uint64  /* destinationChainSelector */,
    Client.EVM2AnyMessage memory /* message */
  ) external view override returns (uint256 fee) {
    return _fee;
  }

  /**
   * @notice Records the sent message and returns a deterministic message ID.
   * @dev Captures the message for test assertions. Returns a predictable ID
   *      so tests can correlate with events.
   */
  function ccipSend(
    uint64  destinationChainSelector,
    Client.EVM2AnyMessage calldata message
  ) external payable override returns (bytes32 messageId) {
    require(msg.value >= _fee, "MockCCIPRouter: insufficient fee");

    // Generate deterministic message ID from sender + nonce.
    messageId = keccak256(
      abi.encodePacked(_nextMessageId, msg.sender, messageCount, destinationChainSelector)
    );

    // Store for test assertions.
    lastMessageId       = messageId;
    lastMessage         = message;
    lastDestinationChain = destinationChainSelector;
    messageCount++;

    emit MessageSent(messageId, destinationChainSelector, message.data);

    // Refund excess ETH (mirrors real router behaviour).
    uint256 excess = msg.value - _fee;
    if (excess > 0) {
      (bool ok, ) = msg.sender.call{value: excess}("");
      require(ok, "MockCCIPRouter: refund failed");
    }
  }
}
