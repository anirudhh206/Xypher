// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable }       from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 }        from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }     from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IRouterClient } from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client }        from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { IGuardianVault } from "../interfaces/IGuardianVault.sol";
import { HealthFactorLib } from "../libraries/HealthFactorLib.sol";
contract GuardianVault is IGuardianVault, Ownable, ReentrancyGuard {

  using SafeERC20    for IERC20;
  using HealthFactorLib for uint256;

  uint256 public constant ETH_LIQ_THRESHOLD_BPS = 8_250;
  uint8 public constant ETH_DECIMALS = 18;
  uint256 public constant GUARDIAN_HF_THRESHOLD = HealthFactorLib.GUARDIAN_HF_MIN;
  uint256 public constant MAX_PRICE_AGE = HealthFactorLib.DEFAULT_MAX_AGE;
  uint256 public constant CCIP_GAS_LIMIT = 200_000;
  uint64 public constant GUARDIAN_COOLDOWN = 5 minutes;
  IRouterClient public immutable ccipRouter;
  AggregatorV3Interface public immutable ethUsdFeed;

  mapping(address user => VaultPosition position) private _positions;
  mapping(address lender => bool trusted) public trustedLenders;
  mapping(uint64 chainSelector => bool allowed) public allowedDestinationChains;
  mapping(uint64 chainSelector => address receiver) public destinationReceivers;
  /// @notice Addresses authorized to call triggerGuardianAction (e.g., Chainlink Automation).
  mapping(address keeper => bool allowed) public authorizedKeepers;

  /// @notice ETH balance reserved for CCIP fees. Funded via fundGuardianPool().
  uint256 public guardianPool;

  constructor(
    address _ccipRouter,
    address _ethUsdFeed,
    address _owner
  ) Ownable(_owner) {
    if (_ccipRouter  == address(0)) revert UnauthorizedCaller();
    if (_ethUsdFeed  == address(0)) revert UnauthorizedCaller();
    ccipRouter  = IRouterClient(_ccipRouter);
    ethUsdFeed  = AggregatorV3Interface(_ethUsdFeed);
  }
  modifier onlyTrustedLender() {
    if (!trustedLenders[msg.sender]) revert UnauthorizedCaller();
    _;
  }

  /// @dev Reverts if msg.sender is neither the owner nor an authorized keeper.
  modifier onlyKeeper() {
    if (msg.sender != owner() && !authorizedKeepers[msg.sender]) {
      revert UnauthorizedCaller();
    }
    _;
  }

  function setDestinationChain(
    uint64  chainSelector,
    bool    allowed,
    address receiver
  ) external onlyOwner {
    allowedDestinationChains[chainSelector] = allowed;
    destinationReceivers[chainSelector]     = allowed ? receiver : address(0);
    emit DestinationChainUpdated(chainSelector, allowed, receiver);
  }


  function setTrustedLender(address lender, bool trusted) external onlyOwner {
    trustedLenders[lender] = trusted;
    emit TrustedLenderUpdated(lender, trusted);
  }

  /**
   * @notice Adds or removes an authorized keeper (e.g., Chainlink Automation upkeep).
   * @dev Only owner. Keepers can call triggerGuardianAction to dispatch CCIP messages.
   * @param keeper  Address to authorize or revoke.
   * @param allowed True to authorize, false to revoke.
   */
  function setKeeper(address keeper, bool allowed) external onlyOwner {
    if (keeper == address(0)) revert UnauthorizedCaller();
    authorizedKeepers[keeper] = allowed;
    emit KeeperUpdated(keeper, allowed);
  }

  /**
   * @notice Deposits ETH into the guardian pool to pay future CCIP fees.
   * @dev Only owner. Allows the CRE automation workflow to trigger guardian
   *      actions without sending ETH — the vault covers CCIP fees from this pool.
   */
  function fundGuardianPool() external payable override onlyOwner {
    guardianPool += msg.value;
    emit GuardianPoolFunded(msg.value);
  }
  function depositCollateral(
    address token,
    uint256 amount
  ) external payable override nonReentrant {
    if (token != address(0)) revert UnsupportedToken(token);
    if (msg.value != amount) revert EthAmountMismatch(msg.value, amount);

    VaultPosition storage pos = _positions[msg.sender];
    pos.collateralToken  = address(0);
    pos.collateralAmount += amount;
    pos.lastHealthCheck  = uint64(block.timestamp);

    emit CollateralDeposited(msg.sender, address(0), amount);
  }
  function withdrawCollateral(
    address token,
    uint256 amount
  ) external override nonReentrant {
    if (token != address(0)) revert UnsupportedToken(token);

    VaultPosition storage pos = _positions[msg.sender];
    if (pos.collateralAmount < amount) {
      revert InsufficientCollateral(msg.sender, pos.collateralAmount, amount);
    }

    uint256 hfAfter = _computeHealthFactorWithCollateral(
      pos.collateralAmount - amount,
      pos.debtAmount
    );
    if (pos.debtAmount > 0 && hfAfter < GUARDIAN_HF_THRESHOLD) {
      revert HealthFactorTooLow(msg.sender, hfAfter, GUARDIAN_HF_THRESHOLD);
    }

    // Effects — update state before external call.
    pos.collateralAmount -= amount;
    pos.lastHealthCheck   = uint64(block.timestamp);

    // Interaction — ETH transfer.
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "ETH transfer failed");

    emit CollateralWithdrawn(msg.sender, address(0), amount);
  }
  function setDebtAmount(
    address user,
    uint256 debtAmountUSD
  ) external override onlyTrustedLender {
    VaultPosition storage pos = _positions[user];
    pos.debtAmount      = debtAmountUSD;
    pos.lastHealthCheck = uint64(block.timestamp);

    uint256 hf = _computeHealthFactorWithCollateral(pos.collateralAmount, debtAmountUSD);
    emit HealthFactorUpdated(user, hf);
  }
  /**
   * @notice Dispatches a CCIP guardian action for a user's position.
   * @dev Called by the CRE guardian-monitor workflow (no msg.value required).
   *      CCIP fees are paid from guardianPool — funded by owner via fundGuardianPool().
   *      Effects before interactions: state is written before ccipSend (CEI).
   */
  function triggerGuardianAction(
    address user,
    uint64  destinationChain
  ) external override nonReentrant onlyKeeper {
    if (!allowedDestinationChains[destinationChain]) {
      revert InvalidChainSelector(destinationChain);
    }

    VaultPosition storage pos = _positions[user];
    uint64  now_        = uint64(block.timestamp);
    uint64  lastTrigger = pos.lastGuardianTrigger;
    if (lastTrigger > 0 && now_ - lastTrigger < GUARDIAN_COOLDOWN) {
      revert GuardianCooldownActive(user, lastTrigger + GUARDIAN_COOLDOWN);
    }

    uint256 currentHF = _computeHealthFactorWithCollateral(
      pos.collateralAmount,
      pos.debtAmount
    );
    if (!HealthFactorLib.needsGuardianAction(currentHF)) {
      revert PositionHealthy(user, currentHF, GUARDIAN_HF_THRESHOLD);
    }

    // ── Effects ───────────────────────────────────────────────────────────
    pos.lastHealthCheck     = now_;
    pos.lastGuardianTrigger = now_;
    emit HealthFactorUpdated(user, currentHF);

    // ── Build CCIP message ────────────────────────────────────────────────
    address receiver = destinationReceivers[destinationChain];
    Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
      receiver:     abi.encode(receiver),
      data:         abi.encode(user, currentHF),
      tokenAmounts: new Client.EVMTokenAmount[](0),
      extraArgs:    Client._argsToBytes(
        Client.EVMExtraArgsV1({ gasLimit: CCIP_GAS_LIMIT })
      ),
      feeToken:     address(0)  // Pay CCIP fee in native ETH from guardianPool
    });

    // ── Validate pool balance ─────────────────────────────────────────────
    uint256 fee = ccipRouter.getFee(destinationChain, message);
    if (guardianPool < fee) revert InsufficientGuardianPool(guardianPool, fee);

    // ── Interaction: deduct pool, send CCIP ───────────────────────────────
    guardianPool -= fee;
    bytes32 messageId = ccipRouter.ccipSend{value: fee}(destinationChain, message);

    emit GuardianActionTriggered(user, destinationChain, messageId);
  }

  function getHealthFactor(address user) external view override returns (uint256 healthFactor) {
    VaultPosition storage pos = _positions[user];
    return _computeHealthFactorWithCollateral(pos.collateralAmount, pos.debtAmount);
  }


  function getVaultPosition(address user) external view override returns (VaultPosition memory) {
    return _positions[user];
  }
  function checkGuardianCondition(address user) external view returns (bool needsAction) {
    VaultPosition storage pos = _positions[user];
    if (pos.debtAmount == 0) return false;
    uint256 hf = _computeHealthFactorWithCollateral(pos.collateralAmount, pos.debtAmount);
    return HealthFactorLib.needsGuardianAction(hf);
  }

  function _computeHealthFactorWithCollateral(
    uint256 collateralAmount,
    uint256 debtUSD
  ) internal view returns (uint256) {
    if (debtUSD == 0) return type(uint256).max;
    if (collateralAmount == 0) return 0; // slither-disable-line incorrect-equality

    (uint256 rawPrice, uint8 feedDecimals) = HealthFactorLib.getPrice(
      ethUsdFeed,
      MAX_PRICE_AGE
    );
    uint256 ethPriceUSD = HealthFactorLib.normalisePrice(rawPrice, feedDecimals);

    return HealthFactorLib.computeHealthFactor(
      collateralAmount,
      ETH_DECIMALS,
      ethPriceUSD,
      ETH_LIQ_THRESHOLD_BPS,
      debtUSD
    );
  }
  receive() external payable {
    if (msg.sender != address(ccipRouter)) revert UnauthorizedCaller();
  }
}
