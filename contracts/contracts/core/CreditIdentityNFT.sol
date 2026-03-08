// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 }           from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable }          from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable }         from "@openzeppelin/contracts/utils/Pausable.sol";
import { Strings }          from "@openzeppelin/contracts/utils/Strings.sol";
import { IConfidentialGuard } from "../interfaces/IConfidentialGuard.sol";

library Base64 {
    bytes internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        // slither-disable-next-line divide-before-multiply
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        bytes memory result = new bytes(encodedLen + 32);
        bytes memory table = TABLE;
        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            for { let i := 0 } lt(i, mload(data)) {} {
                i := add(i, 3)
                let input := and(mload(add(data, i)), 0xffffff)
                let out := mload(add(tablePtr, and(shr(18, input), 0x3F)))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(12, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(6, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(input, 0x3F))), 0xFF))
                out := shl(224, out)
                mstore(resultPtr, out)
                resultPtr := add(resultPtr, 4)
            }
            switch mod(mload(data), 3)
            case 1 { mstore(sub(resultPtr, 2), shl(240, 0x3d3d)) }
            case 2 { mstore(sub(resultPtr, 1), shl(248, 0x3d)) }
            mstore(result, encodedLen)
        }
        return string(result);
    }
}

interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

contract CreditIdentityNFT is ERC721, IERC5192, Ownable, Pausable {
    using Strings for uint256;
    using Strings for uint8;

    IConfidentialGuard public immutable attestationRegistry;

    mapping(address => uint256) private _walletToToken;
    mapping(uint256 => address) private _tokenToWallet;
    mapping(uint256 => uint8)   private _tokenTier;

    uint256 private _nextTokenId = 1;

    error AlreadyMinted(address wallet);
    error NoAttestation(address wallet);
    error Soulbound();
    error ZeroAddress();
    error TokenDoesNotExist(uint256 tokenId);
    error NotAuthorized();

    event CreditIdentityMinted(address indexed wallet, uint256 indexed tokenId, uint8 tier);
    event CreditIdentityBurned(address indexed wallet, uint256 indexed tokenId);
    event CreditIdentityUpdated(uint256 indexed tokenId, uint8 oldTier, uint8 newTier);

    constructor(
        address _attestationRegistry,
        address _owner
    ) ERC721("ConfidentialGuard Credit Identity", "CGCI") Ownable(_owner) {
        if (_attestationRegistry == address(0)) revert ZeroAddress();
        if (_owner               == address(0)) revert ZeroAddress();
        attestationRegistry = IConfidentialGuard(_attestationRegistry);
    }

    function locked(uint256 tokenId) external view override returns (bool) {
        if (_tokenToWallet[tokenId] == address(0)) revert TokenDoesNotExist(tokenId);
        return true;
    }

    function mint() external whenNotPaused {
        address wallet = msg.sender;

        if (_walletToToken[wallet] != 0) revert AlreadyMinted(wallet);

        (bool valid, uint8 tier, ) = attestationRegistry.verifyAttestation(wallet, 5);
        if (!valid) revert NoAttestation(wallet);

        uint256 tokenId = _nextTokenId++;
        _walletToToken[wallet]  = tokenId;
        _tokenToWallet[tokenId] = wallet;
        _tokenTier[tokenId]     = tier;

        _safeMint(wallet, tokenId);

        emit Locked(tokenId);
        emit CreditIdentityMinted(wallet, tokenId, tier);
    }

    function burn() external {
        address wallet = msg.sender;
        uint256 tokenId = _walletToToken[wallet];
        if (tokenId == 0) revert TokenDoesNotExist(0);

        delete _walletToToken[wallet];
        delete _tokenToWallet[tokenId];
        delete _tokenTier[tokenId];

        _burn(tokenId);

        emit CreditIdentityBurned(wallet, tokenId);
    }

    function syncTier(address wallet) external whenNotPaused {
        uint256 tokenId = _walletToToken[wallet];
        if (tokenId == 0) revert TokenDoesNotExist(0);

        (bool valid, uint8 newTier, ) = attestationRegistry.verifyAttestation(wallet, 5);

        uint8 oldTier = _tokenTier[tokenId];

        if (!valid) {
            delete _walletToToken[wallet];
            delete _tokenToWallet[tokenId];
            delete _tokenTier[tokenId];
            _burn(tokenId);
            emit CreditIdentityBurned(wallet, tokenId);
            return;
        }
        if (oldTier != newTier) {
            _tokenTier[tokenId] = newTier;
            emit CreditIdentityUpdated(tokenId, oldTier, newTier);
        }
    }

    function tokenOf(address wallet) external view returns (uint256) {
        return _walletToToken[wallet];
    }

    function tierOf(uint256 tokenId) external view returns (uint8) {
        if (_tokenToWallet[tokenId] == address(0)) revert TokenDoesNotExist(tokenId);
        return _tokenTier[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_tokenToWallet[tokenId] == address(0)) revert TokenDoesNotExist(tokenId);

        uint8 tier = _tokenTier[tokenId];

        string memory svg       = _buildSVG(tokenId, tier);
        string memory imageData = string(abi.encodePacked(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        ));

        string memory json = string(abi.encodePacked(
            '{"name":"ConfidentialGuard Credit Identity #', tokenId.toString(), '",',
            '"description":"A self-sovereign, non-transferable credit identity issued by the ConfidentialGuard Protocol. Credit score computed privately inside a Chainlink TEE.",',
            '"image":"', imageData, '",',
            '"attributes":[',
                '{"trait_type":"Tier","value":"', uint256(tier).toString(), '"},',
                '{"trait_type":"Tier Label","value":"', _tierLabel(tier), '"},',
                '{"trait_type":"Protocol","value":"ConfidentialGuard"},',
                '{"trait_type":"Soulbound","value":"true"}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    function _buildSVG(uint256 tokenId, uint8 tier) internal pure returns (string memory) {
        (
            string memory primaryColor,
            string memory glowColor,
            string memory accentColor,
            string memory label
        ) = _tierVisuals(tier);

        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="400" height="560">',
            '<defs>',
                '<radialGradient id="bg" cx="50%" cy="40%" r="70%">',
                    '<stop offset="0%" stop-color="#0d0d1a"/>',
                    '<stop offset="100%" stop-color="#050508"/>',
                '</radialGradient>',
                '<radialGradient id="glow" cx="50%" cy="50%" r="50%">',
                    '<stop offset="0%" stop-color="', glowColor, '" stop-opacity="0.4"/>',
                    '<stop offset="100%" stop-color="', glowColor, '" stop-opacity="0"/>',
                '</radialGradient>',
                '<filter id="blur">',
                    '<feGaussianBlur stdDeviation="8"/>',
                '</filter>',
                '<filter id="glow-filter">',
                    '<feGaussianBlur stdDeviation="3" result="coloredBlur"/>',
                    '<feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>',
                '</filter>',
                '<linearGradient id="card-border" x1="0%" y1="0%" x2="100%" y2="100%">',
                    '<stop offset="0%" stop-color="', primaryColor, '" stop-opacity="0.8"/>',
                    '<stop offset="50%" stop-color="', accentColor, '" stop-opacity="0.3"/>',
                    '<stop offset="100%" stop-color="', primaryColor, '" stop-opacity="0.8"/>',
                '</linearGradient>',
                '<linearGradient id="tier-badge" x1="0%" y1="0%" x2="100%" y2="100%">',
                    '<stop offset="0%" stop-color="', primaryColor, '"/>',
                    '<stop offset="100%" stop-color="', accentColor, '"/>',
                '</linearGradient>',
            '</defs>',

            '<rect width="400" height="560" rx="24" fill="url(#bg)"/>',
            '<rect width="400" height="560" rx="24" fill="url(#glow)" filter="url(#blur)"/>',
            '<rect x="1" y="1" width="398" height="558" rx="23" fill="none" stroke="url(#card-border)" stroke-width="1.5"/>',

            '<circle cx="200" cy="185" r="120" fill="url(#glow)" filter="url(#blur)"/>',

            _buildHexagonShield(primaryColor, accentColor, glowColor),

            '<text x="200" y="175" text-anchor="middle" font-family="monospace" font-size="11" fill="', primaryColor, '" opacity="0.7" filter="url(#glow-filter)">CREDIT IDENTITY</text>',
            '<text x="200" y="210" text-anchor="middle" font-family="monospace" font-size="42" font-weight="bold" fill="', primaryColor, '" filter="url(#glow-filter)">', uint256(tier).toString(), '</text>',

            '<rect x="120" y="230" width="160" height="32" rx="16" fill="url(#tier-badge)" opacity="0.15"/>',
            '<rect x="120" y="230" width="160" height="32" rx="16" fill="none" stroke="', primaryColor, '" stroke-width="1" opacity="0.5"/>',
            '<text x="200" y="251" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="', primaryColor, '" filter="url(#glow-filter)" letter-spacing="2">', label, '</text>',

            '<line x1="40" y1="295" x2="360" y2="295" stroke="', primaryColor, '" stroke-width="0.5" opacity="0.2"/>',

            '<text x="40" y="330" font-family="monospace" font-size="9" fill="#ffffff" opacity="0.35" letter-spacing="1">PROTOCOL</text>',
            '<text x="40" y="348" font-family="monospace" font-size="13" fill="#ffffff" opacity="0.8">ConfidentialGuard</text>',

            '<text x="40" y="385" font-family="monospace" font-size="9" fill="#ffffff" opacity="0.35" letter-spacing="1">TOKEN ID</text>',
            '<text x="40" y="403" font-family="monospace" font-size="13" fill="#ffffff" opacity="0.8">#', tokenId.toString(), '</text>',

            '<text x="40" y="440" font-family="monospace" font-size="9" fill="#ffffff" opacity="0.35" letter-spacing="1">IDENTITY TYPE</text>',
            '<text x="40" y="458" font-family="monospace" font-size="13" fill="#ffffff" opacity="0.8">Soulbound  \xc2\xb7  Non-Transferable</text>',

            '<line x1="40" y1="490" x2="360" y2="490" stroke="', primaryColor, '" stroke-width="0.5" opacity="0.2"/>',

            '<text x="200" y="515" text-anchor="middle" font-family="monospace" font-size="8" fill="', primaryColor, '" opacity="0.5" letter-spacing="1">POWERED BY CHAINLINK TEE</text>',
            '<text x="200" y="533" text-anchor="middle" font-family="monospace" font-size="7" fill="#ffffff" opacity="0.25">Score computed privately. Only tier stored on-chain.</text>',

            '</svg>'
        ));
    }

    function _buildHexagonShield(
        string memory primaryColor,
        string memory accentColor,
        string memory glowColor
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<polygon points="200,85 240,107 240,153 200,175 160,153 160,107" fill="none" stroke="', primaryColor, '" stroke-width="1.5" opacity="0.3"/>',
            '<polygon points="200,92 234,111 234,149 200,168 166,149 166,111" fill="', glowColor, '" fill-opacity="0.05" stroke="', accentColor, '" stroke-width="1" opacity="0.5"/>',
            '<polygon points="200,100 228,116 228,146 200,162 172,146 172,116" fill="none" stroke="', primaryColor, '" stroke-width="0.5" opacity="0.2"/>'
        ));
    }

    function _tierVisuals(uint8 tier) internal pure returns (
        string memory primaryColor,
        string memory glowColor,
        string memory accentColor,
        string memory label
    ) {
        if (tier == 1) return ("#c084fc", "#a855f7", "#7c3aed", "INSTITUTIONAL");
        if (tier == 2) return ("#67e8f9", "#06b6d4", "#0891b2", "PRIME");
        if (tier == 3) return ("#6ee7b7", "#10b981", "#059669", "NEAR-PRIME");
        if (tier == 4) return ("#fcd34d", "#f59e0b", "#d97706", "SUBPRIME");
        return                ("#f87171", "#ef4444", "#dc2626", "INELIGIBLE");
    }

    function _tierLabel(uint8 tier) internal pure returns (string memory) {
        if (tier == 1) return "Institutional";
        if (tier == 2) return "Prime";
        if (tier == 3) return "Near-Prime";
        if (tier == 4) return "Subprime";
        return "Ineligible";
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return
            interfaceId == type(IERC5192).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
