// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

// ─────────────────────────────────────────────────────────────────────────────
// MockPriceFeed — Minimal Chainlink AggregatorV3Interface for tests
//
// Allows tests to:
//   1. Set arbitrary prices (setPrice)
//   2. Simulate stale data (setUpdatedAt)
//   3. Simulate negative/zero prices (setPrice with negative value)
//
// NOT for production use.
// ─────────────────────────────────────────────────────────────────────────────
contract MockPriceFeed is AggregatorV3Interface {

  // ── Storage ──────────────────────────────────────────────────────────────

  int256  private _answer;
  uint8   private _decimals;
  uint256 private _updatedAt;
  uint80  private _roundId;
  string  private _description;

  // ── Constructor ──────────────────────────────────────────────────────────

  /**
   * @param initialPrice  Initial price (in native decimals, e.g. 300000000000 for ETH/USD at 8dp).
   * @param decimals_     Feed decimals (typically 8 for USD pairs).
   * @param description_  Human-readable feed description.
   */
  constructor(int256 initialPrice, uint8 decimals_, string memory description_) {
    _answer      = initialPrice;
    _decimals    = decimals_;
    _updatedAt   = block.timestamp;
    _roundId     = 1;
    _description = description_;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  /**
   * @notice Sets the price returned by latestRoundData.
   * @param newPrice New price in native decimals. Can be negative (for staleness test).
   */
  function setPrice(int256 newPrice) external {
    _answer    = newPrice;
    _updatedAt = block.timestamp;
    _roundId++;
  }

  /**
   * @notice Sets updatedAt to a specific timestamp (to simulate staleness).
   * @param updatedAt_ Unix timestamp to set as updatedAt.
   */
  function setUpdatedAt(uint256 updatedAt_) external {
    _updatedAt = updatedAt_;
  }

  // ── AggregatorV3Interface implementation ─────────────────────────────────

  function decimals() external view override returns (uint8) {
    return _decimals;
  }

  function description() external view override returns (string memory) {
    return _description;
  }

  function version() external pure override returns (uint256) {
    return 4;
  }

  function latestRoundData()
    external
    view
    override
    returns (
      uint80  roundId,
      int256  answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80  answeredInRound
    )
  {
    roundId         = _roundId;
    answer          = _answer;
    startedAt       = _updatedAt;
    updatedAt       = _updatedAt;
    answeredInRound = _roundId;
  }

  function getRoundData(uint80 /* _roundId */ )
    external
    view
    override
    returns (
      uint80  roundId,
      int256  answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80  answeredInRound
    )
  {
    roundId         = _roundId;
    answer          = _answer;
    startedAt       = _updatedAt;
    updatedAt       = _updatedAt;
    answeredInRound = _roundId;
  }
}
