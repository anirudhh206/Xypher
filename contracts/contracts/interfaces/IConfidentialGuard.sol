// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// IConfidentialGuard — EIP-ready standard for confidential credit attestations
//
// ARCHITECTURE
// ┌──────────────────────────────────────────────────────────────────────┐
// │  Subject wallet          CRE Workflow (TEE)       Lender protocol   │
// │  grantPermission() ──→   Chainlink CRE            verifyAttestation │
// │                          ├─ Confidential HTTP      (minTier check)  │
// │                          │  ├─ Aave / Morpho                        │
// │                          │  ├─ Compound                             │
// │                          │  └─ Plaid (TradFi)                       │
// │                          └─ TEE risk engine                         │
// │                             └─ mintAttestation() ──→ on-chain       │
// └──────────────────────────────────────────────────────────────────────┘
//
// Only the integer tier (1-5) is stored on-chain.
// Zero financial data is ever exposed.
// ─────────────────────────────────────────────────────────────────────────────
interface IConfidentialGuard {

  // ─────────────────────────────────────────────────────────────────────
  // Structs
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice On-chain attestation record. All financial detail stays in TEE.
   * @dev Packed into 2 storage slots:
   *      Slot 0: tier(uint8) + timestamp(uint64) + expiry(uint64) + active(bool) = 18 bytes
   *      Slot 1: subjectHash(bytes32)
   */
  struct Attestation {
    uint8   tier;         // 1 (institutional) → 5 (ineligible)
    uint64  timestamp;    // block.timestamp at mint
    uint64  expiry;       // timestamp + 24 hours (86400 seconds)
    bytes32 subjectHash;  // keccak256(subject, chainId) — anti cross-chain replay
    bool    active;       // false if revoked by subject
  }

  /**
   * @notice Lightweight view struct for frontend queries.
   * @dev attestations mapping stores Attestation; this adds `exists` for callers
   *      that need to distinguish "never minted" from "tier 0".
   */
  struct AttestationView {
    uint8  tier;
    uint64 timestamp;
    uint64 expiry;
    bool   active;
    bool   exists;   // true if mintAttestation was ever called for this subject
  }

  // ─────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────

  /// @notice Emitted when a subject wallet grants assessment permission.
  event PermissionGranted(address indexed subject);

  /// @notice Emitted when a subject wallet revokes assessment permission.
  event PermissionRevoked(address indexed subject);

  /// @notice Emitted when the CRE workflow mints or refreshes an attestation.
  /// @param expiry Unix timestamp of attestation expiry (+24h from mint).
  event AttestationMinted(address indexed subject, uint8 indexed tier, uint64 expiry);

  /// @notice Emitted when an attestation is deactivated (subject revoke or admin revoke).
  event AttestationRevoked(address indexed subject);

  /// @notice Emitted when the owner updates the authorised CRE workflow address.
  event WorkflowAddressUpdated(address indexed oldWorkflow, address indexed newWorkflow);

  // ─────────────────────────────────────────────────────────────────────
  // Errors
  // ─────────────────────────────────────────────────────────────────────

  /// @notice Caller is not the registered CRE workflow address.
  error NotAuthorized();

  /// @notice Tier value is outside the valid range [1, 5].
  error InvalidTier(uint8 tier);

  /// @notice Subject has not called grantPermission() — cannot receive attestation.
  error SubjectNotPermitted(address subject);

  /// @notice Address(0) was passed where a non-zero address is required.
  error ZeroAddress();

  /// @notice mintAttestation called before MIN_MINT_INTERVAL has elapsed since last mint.
  error MintTooFrequent(address subject, uint64 nextAllowedAt);

  // ─────────────────────────────────────────────────────────────────────
  // Subject functions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Authorises the ConfidentialGuard Protocol to assess this wallet.
   * @dev Must be called by the subject before the CRE workflow can mint.
   *      Idempotent — safe to call if already permitted.
   *      Emits PermissionGranted.
   */
  function grantPermission() external;

  /**
   * @notice Removes protocol authorisation and deactivates any live attestation.
   * @dev Safe to call even if not currently permitted.
   *      Emits PermissionRevoked. May also emit AttestationRevoked.
   *      Intentionally NOT pausable — subjects must always be able to revoke consent.
   */
  function revokePermission() external;

  /**
   * @notice Owner-initiated revocation for sanctioned or fraudulent wallets.
   * @dev Compliance enforcement path. Deactivates the attestation and clears
   *      permission without requiring the subject to act. This is required for
   *      regulatory compliance — a sanctioned wallet cannot be allowed to retain
   *      a valid attestation simply because it refuses to call revokePermission().
   *      Emits AttestationRevoked if an active attestation existed.
   * @param subject The wallet to revoke.
   */
  function adminRevokeAttestation(address subject) external;

  // ─────────────────────────────────────────────────────────────────────
  // Workflow functions — onlyWorkflow
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Mints or refreshes a confidential credit attestation.
   * @dev Called exclusively by the registered CRE workflow address.
   *      Subject must have previously called grantPermission().
   *      Gas target: < 50,000 gas.
   * @param subject Wallet address being attested.
   * @param tier    Credit tier [1,5]. 1 = best, 5 = ineligible for new credit.
   */
  function mintAttestation(address subject, uint8 tier) external;

  /**
   * @notice Updates the authorised CRE workflow address.
   * @dev Only callable by owner. Required when the workflow contract is upgraded
   *      or re-deployed. Without this, a compromised or deprecated workflow would
   *      permanently brick the attestation system.
   *      Emits WorkflowAddressUpdated.
   * @param newWorkflow New CRE workflow address. Must be non-zero.
   */
  function setWorkflowAddress(address newWorkflow) external;

  // ─────────────────────────────────────────────────────────────────────
  // View functions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Primary lender integration point. Verifies attestation validity.
   * @dev Gas target: < 5,000 gas.
   *      A valid attestation satisfies ALL of:
   *        1. active == true
   *        2. block.timestamp <= expiry
   *        3. attestation.tier <= minTier  (lower tier = better credit)
   * @param subject Wallet address to verify.
   * @param minTier Maximum acceptable tier (1 = strictest, 4 = most lenient).
   * @return valid  True if all validity conditions are met.
   * @return tier   The subject's actual credit tier.
   * @return expiry Unix timestamp when the attestation expires.
   */
  function verifyAttestation(
    address subject,
    uint8   minTier
  ) external view returns (bool valid, uint8 tier, uint64 expiry);

  /**
   * @notice Returns full attestation data for frontend display.
   * @dev Does not revert if no attestation exists — use `exists` field to check.
   * @param subject Wallet to query.
   */
  function getAttestation(address subject) external view returns (AttestationView memory);

  /**
   * @notice Returns whether a subject wallet has granted permission.
   * @param subject Wallet to check.
   */
  function isPermitted(address subject) external view returns (bool);

  /**
   * @notice Returns true if the subject's attestation expires within `window` seconds.
   * @dev Useful for off-chain automation to proactively trigger reassessment before
   *      expiry. Returns false if the subject has no attestation.
   * @param subject Wallet to check.
   * @param window  Lookahead duration in seconds (e.g. 3600 = expires within 1 hour).
   */
  function isExpiringSoon(address subject, uint64 window) external view returns (bool);
}
