// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable }  from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IConfidentialGuard } from "../interfaces/IConfidentialGuard.sol";
import { AttestationLib }     from "../libraries/AttestationLib.sol";
contract ConfidentialGuardAttestation is IConfidentialGuard, Ownable, Pausable {

  using AttestationLib for uint8;
  uint64 public constant MIN_MINT_INTERVAL = 6 hours;

  address public immutable workflowAddress;
  mapping(address subject => Attestation attestation) private _attestations;

  mapping(address subject => bool permitted) public authorizedSubjects;
  mapping(address subject => uint64 lastMintTimestamp) private _lastMintAt;
  constructor(address _workflowAddress, address _owner) Ownable(_owner) {
    if (_workflowAddress == address(0)) revert ZeroAddress();
    if (_owner           == address(0)) revert ZeroAddress();
    workflowAddress = _workflowAddress;
  }
  modifier onlyWorkflow() {
    if (msg.sender != workflowAddress) revert NotAuthorized();
    _;
  }

  modifier onlyPermittedSubject(address subject) {
    if (!authorizedSubjects[subject]) revert SubjectNotPermitted(subject);
    _;
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

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

  function mintAttestation(
    address subject,
    uint8   tier
  ) external override whenNotPaused onlyWorkflow onlyPermittedSubject(subject) {
    AttestationLib.validateTier(tier);

    // ── Cooldown check ─────────────────────────────────────────────────────
    uint64 now_       = uint64(block.timestamp);
    uint64 lastMint   = _lastMintAt[subject];
    uint64 nextAllowed = lastMint + MIN_MINT_INTERVAL;

    // lastMint == 0 means this is the first ever mint — always allowed.
    if (lastMint > 0 && now_ < nextAllowed) {
      revert MintTooFrequent(subject, nextAllowed);
    }

    // ── Write attestation ──────────────────────────────────────────────────
    uint64  expiry = AttestationLib.computeExpiry(now_);
    bytes32 sHash  = AttestationLib.computeSubjectHash(subject, block.chainid);

    // Single SSTORE write (Solidity compiler packs the struct).
    _attestations[subject] = Attestation({
      tier:        tier,
      timestamp:   now_,
      expiry:      expiry,
      subjectHash: sHash,
      active:      true
    });

    // Record timestamp for next cooldown check.
    _lastMintAt[subject] = now_;

    emit AttestationMinted(subject, tier, expiry);
  }
  function verifyAttestation(
    address subject,
    uint8   minTier
  ) external view override returns (bool valid, uint8 tier, uint64 expiry) {
    Attestation storage a = _attestations[subject];

    tier   = a.tier;
    expiry = a.expiry;
    valid  = AttestationLib.isValid(
      a.tier,
      a.expiry,
      a.active,
      minTier,
      uint64(block.timestamp)
    );
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
      exists:    a.tier > 0   // tier 0 is only possible if never written
    });
  }
  function isPermitted(address subject) external view override returns (bool) {
    return authorizedSubjects[subject];
  }
  function nextMintAllowedAt(address subject) external view returns (uint64) {
    uint64 last = _lastMintAt[subject];
    return last == 0 ? 0 : last + MIN_MINT_INTERVAL;
  }
}
