// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAny2EVMMessageReceiver } from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import { Client }                  from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { Ownable }                 from "@openzeppelin/contracts/access/Ownable.sol";
contract CCIPGuardianReceiver is IAny2EVMMessageReceiver, Ownable {


  struct GuardianAction {
    address user;           
    uint256 healthFactor;   
    uint64  sourceChain;    
    uint64  receivedAt;    
    bool    executed;       
  }


  event GuardianActionReceived(
    bytes32 indexed messageId,
    uint64  indexed sourceChain,
    address indexed user,
    uint256         healthFactor
  );

  event GuardianActionExecuted(
    bytes32 indexed messageId,
    address indexed user
  );

  event ExecutorUpdated(
    address indexed executor,
    bool            allowed
  );
  event SourceChainUpdated(
    uint64  indexed chainSelector,
    bool            allowed,
    address         sender
  );
 
  error InvalidRouter(address caller);
  error UnauthorizedSourceChain(uint64 sourceChainSelector);
  error UnauthorizedSender(address sender);
  error ZeroAddress();
  error MessageAlreadyProcessed(bytes32 messageId);
  error ActionNotPending(bytes32 messageId);
  error NotAuthorized(address caller);

  address public immutable i_ccipRouter;

  mapping(uint64 chainSelector => bool allowed) public allowedSourceChains;

  mapping(uint64 chainSelector => address sender) public allowedSenders;

  mapping(bytes32 messageId => GuardianAction action) public guardianActions;

  mapping(address executor => bool allowed) public authorizedExecutors;

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

  /// @dev Reverts if msg.sender is neither the owner nor an authorized executor.
  modifier onlyExecutor() {
    if (msg.sender != owner() && !authorizedExecutors[msg.sender]) {
      revert NotAuthorized(msg.sender);
    }
    _;
  }
  function setSourceChain(
    uint64  chainSelector,
    bool    allowed,
    address sender
  ) external onlyOwner {
    if (allowed && sender == address(0)) revert ZeroAddress();
    address effectiveSender = allowed ? sender : address(0);
    allowedSourceChains[chainSelector] = allowed;
    allowedSenders[chainSelector]      = effectiveSender;
    emit SourceChainUpdated(chainSelector, allowed, effectiveSender);
  }
  function setExecutor(address executor, bool allowed) external onlyOwner {
    if (executor == address(0)) revert ZeroAddress();
    authorizedExecutors[executor] = allowed;
    emit ExecutorUpdated(executor, allowed);
  }
  function ccipReceive(
    Client.Any2EVMMessage calldata message
  ) external override onlyRouter {
    // ── Defense-in-depth: reject duplicate messages ─────────────────────────
    if (guardianActions[message.messageId].receivedAt != 0) {
      revert MessageAlreadyProcessed(message.messageId);
    }

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

    guardianActions[message.messageId] = GuardianAction({
      user:         user,
      healthFactor: healthFactor,
      sourceChain:  sourceChain,
      receivedAt:   uint64(block.timestamp),
      executed:     false
    });

    emit GuardianActionReceived(
      message.messageId,
      sourceChain,
      user,
      healthFactor
    );
  }

  function executeAction(bytes32 messageId) external onlyExecutor {
    GuardianAction storage action = guardianActions[messageId];
    if (action.receivedAt == 0 || action.executed) {
      revert ActionNotPending(messageId);
    }
    action.executed = true;
    emit GuardianActionExecuted(messageId, action.user);
  }

  
  function getGuardianAction(
    bytes32 messageId
  ) external view returns (GuardianAction memory) {
    return guardianActions[messageId];
  }

  function isAllowedSourceChain(uint64 chainSelector) external view returns (bool) {
    return allowedSourceChains[chainSelector];
  }
  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == type(IAny2EVMMessageReceiver).interfaceId;
  }
}
