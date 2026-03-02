// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAny2EVMMessageReceiver } from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import { Client }                  from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { Ownable }                 from "@openzeppelin/contracts/access/Ownable.sol";

// ─────────────────────────────────────────────────────────────────────────────
// CCIPGuardianReceiver — Cross-chain guardian action executor
//
// Deployed on destination chains (e.g., Base Sepolia).
// Receives CCIP messages from GuardianVault on the source chain (e.g., Sepolia).
// Executes rebalancing actions in response to health factor alerts.
//
// SECURITY MODEL
//   1. Only the registered CCIP router can call ccipReceive (onlyRouter modifier).
//   2. Only messages from allowed source chains are processed.
//   3. Only messages from the registered GuardianVault on each source chain.
//   4. Re-entrancy is not possible (router is trusted, no ETH transfers here).
//
// NOTE: Implements IAny2EVMMessageReceiver directly (not via CCIPReceiver base)
// to avoid the @openzeppelin/contracts@5.0.2 version-pinned import in the CCIP
// base contract. The security guarantee is identical: onlyRouter enforces that
// only the CCIP router can call ccipReceive.
// ─────────────────────────────────────────────────────────────────────────────
contract CCIPGuardianReceiver is IAny2EVMMessageReceiver, Ownable {

  // ── Structs ──────────────────────────────────────────────────────────────

  /**
   * @notice Records a received guardian action for a user.
   * @dev Stored on-chain for audit trail and off-chain indexers.
   */
  struct GuardianAction {
    address user;           // Position owner on source chain
    uint256 healthFactor;   // HF at time of trigger (1e18 precision)
    uint64  sourceChain;    // Source chain selector
    uint64  receivedAt;     // block.timestamp of receipt
    bool    executed;       // True once action has been processed
  }

  // ── Events ───────────────────────────────────────────────────────────────

  /// @notice Emitted when a guardian action message is received and executed.
  event GuardianActionReceived(
    bytes32 indexed messageId,
    uint64  indexed sourceChain,
    address indexed user,
    uint256         healthFactor
  );

  /// @notice Emitted when a source chain is added or removed.
  event SourceChainUpdated(
    uint64  indexed chainSelector,
    bool            allowed,
    address         sender
  );

  // ── Errors ───────────────────────────────────────────────────────────────

  /// @notice Caller is not the registered CCIP router.
  error InvalidRouter(address caller);

  /// @notice Message received from a chain not in the allowed set.
  error UnauthorizedSourceChain(uint64 sourceChainSelector);

  /// @notice Message received from an address not registered as the vault sender.
  error UnauthorizedSender(address sender);

  /// @notice An address(0) was passed where a valid address is required.
  error ZeroAddress();

  // ── Immutables ───────────────────────────────────────────────────────────

  /// @notice The CCIP router address on this (destination) chain.
  /// @dev Immutable — mirrors CCIPReceiver.i_ccipRouter behaviour.
  address public immutable i_ccipRouter;

  // ── Storage ──────────────────────────────────────────────────────────────

  /// @notice Set of allowed source chain selectors.
  mapping(uint64 chainSelector => bool allowed) public allowedSourceChains;

  /// @notice Registered GuardianVault sender on each source chain.
  mapping(uint64 chainSelector => address sender) public allowedSenders;

  /// @notice Guardian action history: messageId → GuardianAction.
  mapping(bytes32 messageId => GuardianAction action) public guardianActions;

  // ── Constructor ──────────────────────────────────────────────────────────

  /**
   * @param _ccipRouter CCIP Router address on this (destination) chain.
   * @param _owner      Protocol admin address.
   */
  constructor(address _ccipRouter, address _owner) Ownable(_owner) {
    if (_ccipRouter == address(0)) revert ZeroAddress();
    if (_owner      == address(0)) revert ZeroAddress();
    i_ccipRouter = _ccipRouter;
  }

  // ── Modifiers ────────────────────────────────────────────────────────────

  /// @dev Reverts if msg.sender is not the registered CCIP router.
  modifier onlyRouter() {
    if (msg.sender != i_ccipRouter) revert InvalidRouter(msg.sender);
    _;
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /**
   * @notice Adds or removes a source chain + sender pair.
   * @dev Only owner. Must be called before GuardianVault on the source chain
   *      can send CCIP messages to this receiver.
   * @param chainSelector CCIP chain selector of the source chain.
   * @param allowed       True to allow, false to revoke.
   * @param sender        GuardianVault contract address on the source chain.
   */
  function setSourceChain(
    uint64  chainSelector,
    bool    allowed,
    address sender
  ) external onlyOwner {
    allowedSourceChains[chainSelector] = allowed;
    allowedSenders[chainSelector]      = allowed ? sender : address(0);
    emit SourceChainUpdated(chainSelector, allowed, sender);
  }

  // ── CCIP receive ─────────────────────────────────────────────────────────

  /**
   * @notice Processes an incoming CCIP guardian action message.
   * @dev Called exclusively by the CCIP Router (onlyRouter modifier).
   *
   *      Validation:
   *        1. msg.sender must be i_ccipRouter (onlyRouter).
   *        2. sourceChainSelector must be in allowedSourceChains.
   *        3. decoded sender address must match allowedSenders[sourceChain].
   *
   *      Payload: abi.encode(address user, uint256 healthFactor)
   *
   *      The GuardianActionReceived event serves as the verifiable on-chain
   *      proof of cross-chain guardian action. In production this would also
   *      trigger an automated rebalancing call (e.g., supply more collateral).
   *
   * @param message The CCIP Any2EVM message from the source chain.
   */
  function ccipReceive(
    Client.Any2EVMMessage calldata message
  ) external override onlyRouter {
    // ── Validate source chain ──────────────────────────────────────────────
    uint64 sourceChain = message.sourceChainSelector;
    if (!allowedSourceChains[sourceChain]) {
      revert UnauthorizedSourceChain(sourceChain);
    }

    // ── Validate sender ───────────────────────────────────────────────────
    address sender = abi.decode(message.sender, (address));
    if (sender != allowedSenders[sourceChain]) {
      revert UnauthorizedSender(sender);
    }

    // ── Decode payload ────────────────────────────────────────────────────
    (address user, uint256 healthFactor) = abi.decode(
      message.data,
      (address, uint256)
    );

    // ── Record action ─────────────────────────────────────────────────────
    guardianActions[message.messageId] = GuardianAction({
      user:         user,
      healthFactor: healthFactor,
      sourceChain:  sourceChain,
      receivedAt:   uint64(block.timestamp),
      executed:     true
    });

    emit GuardianActionReceived(
      message.messageId,
      sourceChain,
      user,
      healthFactor
    );
  }

  // ── View functions ────────────────────────────────────────────────────────

  /**
   * @notice Returns a guardian action by CCIP message ID.
   * @param messageId CCIP message identifier from GuardianActionTriggered event.
   */
  function getGuardianAction(
    bytes32 messageId
  ) external view returns (GuardianAction memory) {
    return guardianActions[messageId];
  }

  /**
   * @notice Returns whether a source chain is allowed.
   * @param chainSelector CCIP chain selector to check.
   */
  function isAllowedSourceChain(uint64 chainSelector) external view returns (bool) {
    return allowedSourceChains[chainSelector];
  }

  /**
   * @notice ERC-165 support — reports IAny2EVMMessageReceiver.
   */
  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IAny2EVMMessageReceiver).interfaceId;
  }
}
