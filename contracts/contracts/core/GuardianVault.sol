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
  mapping(address caller => uint256 amount) public pendingRefunds;

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
  function triggerGuardianAction(
    address user,
    uint64  destinationChain
  ) external payable override nonReentrant {
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

    pos.lastHealthCheck     = now_;
    pos.lastGuardianTrigger = now_;
    emit HealthFactorUpdated(user, currentHF);

    address receiver = destinationReceivers[destinationChain];
    Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
      receiver:     abi.encode(receiver),
      data:         abi.encode(user, currentHF),
      tokenAmounts: new Client.EVMTokenAmount[](0),
      extraArgs:    Client._argsToBytes(
        Client.EVMExtraArgsV1({ gasLimit: CCIP_GAS_LIMIT })
      ),
      feeToken:     address(0)  // Pay CCIP fee in native ETH
    });
    uint256 fee = ccipRouter.getFee(destinationChain, message);
    if (msg.value < fee) revert InsufficientFeeProvided(msg.value, fee);

    bytes32 messageId = ccipRouter.ccipSend{value: fee}(destinationChain, message);

    emit GuardianActionTriggered(user, destinationChain, messageId);

    uint256 excess = msg.value - fee;
    if (excess > 0) {
      pendingRefunds[msg.sender] += excess;
      emit RefundPending(msg.sender, excess);
    }
  }

  function withdrawRefund() external override nonReentrant {
    uint256 amount = pendingRefunds[msg.sender];
    if (amount == 0) revert NoRefundPending();

    // Effects before interaction.
    pendingRefunds[msg.sender] = 0;

    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Refund transfer failed");
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
    if (collateralAmount == 0) return 0;

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
