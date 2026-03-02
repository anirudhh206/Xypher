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

  /// @notice Emitted when an attestation is deactivated (via revokePermission).
  event AttestationRevoked(address indexed subject);

  // ─────────────────────────────────────────────────────────────────────
  // Errors
  // ─────────────────────────────────────────────────────────────────────

  /// @notice Caller is not the registered CRE workflow address.
  error NotAuthorized();

  /// @notice Tier value is outside the valid range [1, 5].
  error InvalidTier(uint8 tier);

  /// @notice Subject has not called grantPermission() — cannot receive attestation.
  error SubjectNotPermitted(address subject);

  /// @notice Attestation exists but has passed its expiry timestamp.
  error AttestationExpired(address subject, uint64 expiry);

  /// @notice Attestation exists but active flag is false (revoked).
  error AttestationNotActive(address subject);

  /// @notice Address(0) was passed where a non-zero address is required.
  error ZeroAddress();

  /// @notice mintAttestation called before MIN_MINT_INTERVAL has elapsed since last mint.
  error MintTooFrequent(address subject, uint64 nextAllowedAt);

  /// @notice Operation rejected because the contract is paused.
  error ContractPaused();

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
   */
  function revokePermission() external;

  // ─────────────────────────────────────────────────────────────────────
  // Workflow functions — onlyWorkflow
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Mints or refreshes a confidential credit attestation.
   * @dev Called exclusively by the Chainlink CRE workflow address (immutable).
   *      Subject must have previously called grantPermission().
   *      Gas target: < 50,000 gas.
   * @param subject Wallet address being attested.
   * @param tier    Credit tier [1,5]. 1 = best, 5 = ineligible for new credit.
   */
  function mintAttestation(address subject, uint8 tier) external;

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
}
