// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable }        from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable }       from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRouterClient }  from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client }         from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { IConfidentialGuard } from "../interfaces/IConfidentialGuard.sol";
import { AttestationLib }     from "../libraries/AttestationLib.sol";

contract ConfidentialGuardAttestation is IConfidentialGuard, Ownable, Pausable, ReentrancyGuard {

  using AttestationLib for uint8;

  // ── Constants ─────────────────────────────────────────────────────────────

  uint64 public constant MIN_MINT_INTERVAL   = 6 hours;
  uint256 public constant BROADCAST_GAS_LIMIT = 200_000;

  // ── Core storage ──────────────────────────────────────────────────────────

  address public workflowAddress;
  mapping(address subject => Attestation attestation)        private _attestations;
  mapping(address subject => bool permitted)                 public  authorizedSubjects;
  mapping(address subject => uint64 lastMintTimestamp)       private _lastMintAt;

  // ── Cross-chain broadcast storage ─────────────────────────────────────────

  IRouterClient public ccipRouter;
  uint256       public broadcastPool;

  struct DestinationChain {
    address receiver;
    bool    active;
  }

  mapping(uint64 => DestinationChain) public destinationChains;
  uint64[] private _registeredChains;

  // ── Events ────────────────────────────────────────────────────────────────

  event AttestationBroadcast(
    address indexed wallet,
    uint64  indexed chainSelector,
    bytes32         ccipMessageId
  );
  event DestinationChainRegistered(uint64 indexed chainSelector, address receiver);
  event DestinationChainRemoved(uint64 indexed chainSelector);
  event BroadcastPoolFunded(address indexed funder, uint256 amount);
  event BroadcastPoolWithdrawn(address indexed to, uint256 amount);
  event CCIPRouterSet(address router);

  // ── Errors ────────────────────────────────────────────────────────────────

  error CCIPRouterNotSet();
  error ChainNotRegistered(uint64 chainSelector);
  error InsufficientBroadcastFunds(uint256 available, uint256 required);

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(address _owner) Ownable(_owner) {
    if (_owner == address(0)) revert ZeroAddress();
  }

  // ── Modifiers ─────────────────────────────────────────────────────────────

  modifier onlyWorkflow() {
    if (msg.sender != workflowAddress) revert NotAuthorized();
    _;
  }

  modifier onlyPermittedSubject(address subject) {
    if (!authorizedSubjects[subject]) revert SubjectNotPermitted(subject);
    _;
  }

  // ── Admin — core ──────────────────────────────────────────────────────────

  function setWorkflowAddress(address newWorkflow) external override onlyOwner {
    if (newWorkflow == address(0)) revert ZeroAddress();
    emit WorkflowAddressUpdated(workflowAddress, newWorkflow);
    workflowAddress = newWorkflow;
  }

  function pause()   external onlyOwner { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  // ── Admin — CCIP broadcast ────────────────────────────────────────────────

  function setCCIPRouter(address _router) external onlyOwner {
    if (_router == address(0)) revert ZeroAddress();
    ccipRouter = IRouterClient(_router);
    emit CCIPRouterSet(_router);
  }

  function registerDestinationChain(
    uint64  chainSelector,
    address receiver
  ) external onlyOwner {
    if (receiver == address(0)) revert ZeroAddress();
    if (!destinationChains[chainSelector].active) {
      _registeredChains.push(chainSelector);
    }
    destinationChains[chainSelector] = DestinationChain({ receiver: receiver, active: true });
    emit DestinationChainRegistered(chainSelector, receiver);
  }

  function removeDestinationChain(uint64 chainSelector) external onlyOwner {
    delete destinationChains[chainSelector];
    emit DestinationChainRemoved(chainSelector);
  }

  function fundBroadcastPool() external payable {
    broadcastPool += msg.value;
    emit BroadcastPoolFunded(msg.sender, msg.value);
  }

  function withdrawBroadcastPool(uint256 amount) external onlyOwner {
    require(amount <= broadcastPool, "Insufficient pool");
    broadcastPool -= amount;
    emit BroadcastPoolWithdrawn(owner(), amount);
    // slither-disable-next-line arbitrary-send-eth
    (bool ok, ) = owner().call{value: amount}("");
    require(ok, "Withdraw failed");
  }

  // ── Permission ────────────────────────────────────────────────────────────

  function grantPermission() external override whenNotPaused {
    authorizedSubjects[msg.sender] = true;
    emit PermissionGranted(msg.sender);
  }

  function revokePermission() external override {
    authorizedSubjects[msg.sender] = false;
    if (_attestations[msg.sender].active) {
      _attestations[msg.sender].active = false;
      emit AttestationRevoked(msg.sender);
    }
    emit PermissionRevoked(msg.sender);
  }

  // ── Mint ──────────────────────────────────────────────────────────────────

  function mintAttestation(
    address subject,
    uint8   tier,
    uint64  expiresAt
  ) external override whenNotPaused onlyWorkflow onlyPermittedSubject(subject) {
    AttestationLib.validateTier(tier);

    uint64 now_        = uint64(block.timestamp);
    uint64 lastMint    = _lastMintAt[subject];
    uint64 nextAllowed = lastMint + MIN_MINT_INTERVAL;

    if (lastMint > 0 && now_ < nextAllowed) {
      revert MintTooFrequent(subject, nextAllowed);
    }

    uint64  expiry = expiresAt > 0 ? expiresAt : AttestationLib.computeExpiry(now_);
    bytes32 sHash  = AttestationLib.computeSubjectHash(subject, block.chainid);

    _attestations[subject] = Attestation({
      tier:        tier,
      timestamp:   now_,
      expiry:      expiry,
      subjectHash: sHash,
      active:      true
    });

    _lastMintAt[subject] = now_;

    emit AttestationMinted(subject, tier, expiry);

    _autoBroadcast(subject, 1);
  }

  // ── Verify ────────────────────────────────────────────────────────────────

  function verifyAttestation(
    address subject,
    uint8   minTier
  ) external view override returns (bool valid, uint8 tier, uint64 expiry) {
    Attestation storage a = _attestations[subject];
    tier   = a.tier;
    expiry = a.expiry;
    valid  = AttestationLib.isValid(a.tier, a.expiry, a.active, minTier, uint64(block.timestamp));
  }

  function getAttestation(
    address subject
  ) external view override returns (AttestationView memory) {
    Attestation storage a = _attestations[subject];
    return AttestationView({
      tier:      a.tier,
      timestamp: a.timestamp,
      expiry:    a.expiry,
      active:    a.active,
      exists:    a.timestamp > 0
    });
  }

  function isPermitted(address subject) external view override returns (bool) {
    return authorizedSubjects[subject];
  }

  function isExpiringSoon(address subject, uint64 window) external view override returns (bool) {
    uint64 exp = _attestations[subject].expiry;
    if (exp == 0) return false; // slither-disable-line incorrect-equality
    uint64 ts = uint64(block.timestamp);
    if (ts >= exp) return false;
    return ts + window >= exp;
  }

  function nextMintAllowedAt(address subject) external view returns (uint64) {
    uint64 last = _lastMintAt[subject];
    return last == 0 ? 0 : last + MIN_MINT_INTERVAL; // slither-disable-line incorrect-equality
  }

  // ── Admin revoke ──────────────────────────────────────────────────────────

  function adminRevokeAttestation(address subject) external override onlyOwner {
    authorizedSubjects[subject] = false;
    emit PermissionRevoked(subject);

    if (_attestations[subject].active) {
      _attestations[subject].active = false;
      emit AttestationRevoked(subject);
      _autoBroadcast(subject, 2);
    }
  }

  // ── Manual broadcast ──────────────────────────────────────────────────────

  function broadcastAttestation(
    address wallet,
    uint64  destinationChainSelector
  ) external payable nonReentrant whenNotPaused {
    if (address(ccipRouter) == address(0)) revert CCIPRouterNotSet();

    DestinationChain storage dest = destinationChains[destinationChainSelector];
    if (!dest.active) revert ChainNotRegistered(destinationChainSelector);

    Attestation storage att = _attestations[wallet];
    if (att.expiry == 0 || !att.active) revert NotAuthorized();

    if (msg.value > 0) broadcastPool += msg.value;

    bytes32 messageId = _sendCCIP(
      destinationChainSelector,
      dest.receiver,
      abi.encode(uint8(1), wallet, att.tier, att.expiry)
    );

    emit AttestationBroadcast(wallet, destinationChainSelector, messageId);
  }

  function getRegisteredChains() external view returns (uint64[] memory) {
    return _registeredChains;
  }

  // ── Internal broadcast ────────────────────────────────────────────────────

  function _autoBroadcast(address wallet, uint8 action) internal {
    if (address(ccipRouter) == address(0)) return;
    if (_registeredChains.length == 0) return;

    Attestation storage att = _attestations[wallet];

    bytes memory payload = action == 1
      ? abi.encode(uint8(1), wallet, att.tier, att.expiry)
      : abi.encode(uint8(2), wallet, uint8(0), uint64(0));

    for (uint256 i = 0; i < _registeredChains.length; i++) {
      uint64 sel = _registeredChains[i];
      DestinationChain storage dest = destinationChains[sel];
      if (!dest.active) continue;

      Client.EVM2AnyMessage memory ccipMsg = _buildCCIPMessage(dest.receiver, payload);
      uint256 fee = ccipRouter.getFee(sel, ccipMsg);

      if (broadcastPool < fee) continue;

      broadcastPool -= fee;

      // slither-disable-next-line arbitrary-send-eth,reentrancy-eth
      try ccipRouter.ccipSend{value: fee}(sel, ccipMsg) returns (bytes32 messageId) {
        emit AttestationBroadcast(wallet, sel, messageId);
      } catch {
        broadcastPool += fee;
      }
    }
  }

  function _sendCCIP(
    uint64  chainSelector,
    address receiver,
    bytes memory payload
  ) internal returns (bytes32) {
    Client.EVM2AnyMessage memory ccipMsg = _buildCCIPMessage(receiver, payload);
    uint256 fee = ccipRouter.getFee(chainSelector, ccipMsg);

    if (broadcastPool < fee) revert InsufficientBroadcastFunds(broadcastPool, fee);
    broadcastPool -= fee;

    // slither-disable-next-line arbitrary-send-eth
    return ccipRouter.ccipSend{value: fee}(chainSelector, ccipMsg);
  }

  function _buildCCIPMessage(
    address receiver,
    bytes memory payload
  ) internal pure returns (Client.EVM2AnyMessage memory) {
    return Client.EVM2AnyMessage({
      receiver:     abi.encode(receiver),
      data:         payload,
      tokenAmounts: new Client.EVMTokenAmount[](0),
      extraArgs:    Client._argsToBytes(Client.EVMExtraArgsV1({ gasLimit: BROADCAST_GAS_LIMIT })),
      feeToken:     address(0)
    });
  }

  receive() external payable {
    broadcastPool += msg.value;
    emit BroadcastPoolFunded(msg.sender, msg.value);
  }
}
