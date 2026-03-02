// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// AttestationLib — Pure functions for attestation lifecycle management
//
// Used exclusively by ConfidentialGuardAttestation.sol.
// Zero state mutations. All functions are internal — deployed as part of the
// attestation contract (no library address, no DELEGATECALL overhead).
// ─────────────────────────────────────────────────────────────────────────────
library AttestationLib {

  // ── Constants ─────────────────────────────────────────────────────────────

  /// @notice Attestation validity window: 24 hours in seconds.
  /// @dev Lenders should re-verify before issuing credit if attestation is
  ///      approaching expiry. Auto-refresh happens via CRE Automation.
  uint64 internal constant ATTESTATION_TTL = 86_400;

  /// @notice Minimum valid tier. Tier 1 = best institutional credit.
  uint8 internal constant MIN_TIER = 1;

  /// @notice Maximum valid tier. Tier 5 = ineligible for new credit.
  uint8 internal constant MAX_TIER = 5;

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @notice Tier is outside the legal range [1, 5].
  error InvalidTier(uint8 tier);

  // ── Functions ─────────────────────────────────────────────────────────────

  /**
   * @notice Computes the deterministic subject hash stored in each attestation.
   * @dev Binding to chainId prevents cross-chain replay: a Sepolia attestation
   *      cannot be submitted as valid on Base Sepolia or mainnet.
   *
   *      Hash inputs:
   *        - subject: the wallet being attested (prevents attestation transfer)
   *        - chainId: block.chainid at mint time (prevents cross-chain replay)
   *
   * @param subject The wallet address being attested.
   * @param chainId block.chainid at the time of minting.
   * @return Deterministic 32-byte binding hash.
   */
  function computeSubjectHash(
    address subject,
    uint256 chainId
  ) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(subject, chainId));
  }

  /**
   * @notice Computes the expiry timestamp for a new attestation.
   * @dev Expiry is enforced strictly on-chain. A single second past expiry
   *      invalidates the attestation — no grace period.
   * @param currentTimestamp block.timestamp at mint time, cast to uint64.
   * @return expiry Unix timestamp exactly ATTESTATION_TTL seconds in the future.
   */
  function computeExpiry(uint64 currentTimestamp) internal pure returns (uint64) {
    return currentTimestamp + ATTESTATION_TTL;
  }

  /**
   * @notice Validates that a tier value is within the legal range [MIN_TIER, MAX_TIER].
   * @dev Reverts with InvalidTier if out of range. Called in mintAttestation
   *      before writing to storage, preventing corruption from buggy TEE output.
   * @param tier The tier value to validate.
   */
  function validateTier(uint8 tier) internal pure {
    if (tier < MIN_TIER || tier > MAX_TIER) revert InvalidTier(tier);
  }

  /**
   * @notice Checks whether an attestation passes all validity conditions.
   * @dev This is the single source of truth for attestation validity.
   *      Conditions (all must hold):
   *        1. active == true         (not revoked by subject)
   *        2. !isExpired(...)        (within 24h TTL)
   *        3. tier <= minTier        (meets minimum credit quality)
   *
   *      Note on tier semantics: lower tier = better credit.
   *        Tier 1 satisfies minTier=1,2,3,4 (any).
   *        Tier 4 only satisfies minTier=4 (strictest lenders reject this).
   *        Tier 5 never satisfies any minTier (ineligible by design).
   *
   * @param tier             The stored tier (1-5).
   * @param expiry           The stored expiry timestamp.
   * @param active           The stored active flag.
   * @param minTier          The caller's minimum required tier.
   * @param currentTimestamp block.timestamp, cast to uint64.
   * @return True if all three validity conditions are satisfied.
   */
  function isValid(
    uint8  tier,
    uint64 expiry,
    bool   active,
    uint8  minTier,
    uint64 currentTimestamp
  ) internal pure returns (bool) {
    return active
      && !isExpired(expiry, currentTimestamp)
      && tier <= minTier;
  }

  /**
   * @notice Returns true if the attestation has passed its expiry timestamp.
   * @dev Uses strict inequality: at exactly expiry, the attestation is still valid.
   *      One second past expiry, it is expired.
   * @param expiry           Stored expiry timestamp.
   * @param currentTimestamp block.timestamp, cast to uint64.
   */
  function isExpired(uint64 expiry, uint64 currentTimestamp) internal pure returns (bool) {
    return currentTimestamp > expiry;
  }
}
