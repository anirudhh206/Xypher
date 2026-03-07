// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable }        from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable }       from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRouterClient }  from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { IAny2EVMMessageReceiver } from "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import { Client }         from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { IERC165 }        from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract CrossChainAttestationReceiver is
    IAny2EVMMessageReceiver,
    IERC165,
    Ownable,
    Pausable,
    ReentrancyGuard
{
    // ── Structs ───────────────────────────────────────────────────────────

    struct MirroredAttestation {
        uint8   tier;
        uint64  issuedAt;
        uint64  expiresAt;
        uint64  receivedAt;
        uint64  sourceChainSelector;
        bool    active;
    }

    // ── Storage ───────────────────────────────────────────────────────────

    IRouterClient public immutable ccipRouter;

    mapping(uint64  => address) public allowedSenders;
    mapping(bytes32 => bool)    private _processedMessages;
    mapping(address => MirroredAttestation) private _attestations;

    // ── Events ────────────────────────────────────────────────────────────

    event AttestationMirrored(
        address indexed wallet,
        uint8           tier,
        uint64          expiresAt,
        uint64          sourceChainSelector,
        bytes32         messageId
    );
    event AttestationRevoked(address indexed wallet, bytes32 messageId);
    event AllowedSenderSet(uint64 indexed chainSelector, address sender);

    // ── Errors ────────────────────────────────────────────────────────────

    error UnauthorizedSender(uint64 chainSelector, address sender);
    error DuplicateMessage(bytes32 messageId);
    error InvalidPayload();
    error ZeroAddress();
    error OnlyCCIPRouter();

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _ccipRouter, address _owner) Ownable(_owner) {
        if (_ccipRouter == address(0)) revert ZeroAddress();
        if (_owner      == address(0)) revert ZeroAddress();
        ccipRouter = IRouterClient(_ccipRouter);
    }

    // ── CCIP Receive ──────────────────────────────────────────────────────

    function ccipReceive(
        Client.Any2EVMMessage calldata message
    ) external override nonReentrant whenNotPaused {
        if (msg.sender != address(ccipRouter)) revert OnlyCCIPRouter();

        bytes32 messageId      = message.messageId;
        uint64  sourceSelector = message.sourceChainSelector;
        address sourceSender   = abi.decode(message.sender, (address));

        if (_processedMessages[messageId]) revert DuplicateMessage(messageId);
        _processedMessages[messageId] = true;

        address allowed = allowedSenders[sourceSelector];
        if (allowed == address(0) || allowed != sourceSender) {
            revert UnauthorizedSender(sourceSelector, sourceSender);
        }

        if (message.data.length < 64) revert InvalidPayload();

        (uint8 action, address wallet, uint8 tier, uint64 expiresAt) =
            abi.decode(message.data, (uint8, address, uint8, uint64));

        if (action == 1) {
            _attestations[wallet] = MirroredAttestation({
                tier:                tier,
                issuedAt:            uint64(block.timestamp),
                expiresAt:           expiresAt,
                receivedAt:          uint64(block.timestamp),
                sourceChainSelector: sourceSelector,
                active:              true
            });
            emit AttestationMirrored(wallet, tier, expiresAt, sourceSelector, messageId);
        } else if (action == 2) {
            delete _attestations[wallet];
            emit AttestationRevoked(wallet, messageId);
        }
    }

    // ── View ──────────────────────────────────────────────────────────────

    function verifyAttestation(
        address wallet,
        uint8   minTier
    ) external view returns (bool valid, uint8 tier, uint64 expiresAt) {
        MirroredAttestation storage att = _attestations[wallet];
        if (!att.active)                          return (false, 0, 0);
        if (block.timestamp >= att.expiresAt)     return (false, 0, 0);
        if (att.tier > minTier)                   return (false, 0, 0);
        return (true, att.tier, att.expiresAt);
    }

    function getAttestation(address wallet) external view returns (MirroredAttestation memory) {
        return _attestations[wallet];
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setAllowedSender(
        uint64  chainSelector,
        address sender
    ) external onlyOwner {
        if (sender == address(0)) revert ZeroAddress();
        allowedSenders[chainSelector] = sender;
        emit AllowedSenderSet(chainSelector, sender);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── ERC165 ────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == type(IAny2EVMMessageReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
