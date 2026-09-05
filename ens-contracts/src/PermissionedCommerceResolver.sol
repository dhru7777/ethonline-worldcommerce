// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal permissioned text resolver for EAC demos under *.shopify.eth.
 * Admin (Shopify) can set any text; merchants need authorizeTextRoles per key.
 */
contract PermissionedCommerceResolver {
    address public immutable admin;

    /// namehash => key => value
    mapping(bytes32 => mapping(string => string)) public texts;
    /// namehash => key => account => granted (record-level EAC)
    mapping(bytes32 => mapping(string => mapping(address => bool))) public textRoles;
    /// namehash => account => granted (name-level EAC — any text key)
    mapping(bytes32 => mapping(address => bool)) public nameRoles;
    /// optional addr(bytes32) records
    mapping(bytes32 => address) public addresses;

    error NotAdmin();
    error EACUnauthorized(address account, string key);
    error InvalidDnsName();
    error UnsupportedSelector(bytes4 selector);

    /// Official ITextResolver event (indexed key hash) so explorers can index keys.
    event TextChanged(
        bytes32 indexed node,
        string indexed indexedKey,
        string key,
        string value
    );
    event TextRoleChanged(bytes32 indexed node, string key, address account, bool granted);
    event NameRoleChanged(bytes32 indexed node, address account, bool granted);
    event AddrChanged(bytes32 indexed node, address a);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        require(admin_ != address(0), "zero");
        admin = admin_;
    }

    /// @dev DNS wire-format namehash (labels left-to-right in packet, hash TLD→root).
    function dnsNamehash(bytes calldata name) public pure returns (bytes32 node) {
        if (name.length == 0) revert InvalidDnsName();
        // Count labels
        uint256 count;
        uint256 offset;
        while (offset < name.length) {
            uint256 len = uint8(name[offset]);
            if (len == 0) break;
            unchecked {
                offset += 1 + len;
                ++count;
            }
            if (offset > name.length) revert InvalidDnsName();
        }
        if (count == 0) revert InvalidDnsName();

        bytes32[] memory labelHashes = new bytes32[](count);
        offset = 0;
        for (uint256 i = 0; i < count; ) {
            uint256 len = uint8(name[offset]);
            labelHashes[i] = keccak256(name[offset + 1:offset + 1 + len]);
            unchecked {
                offset += 1 + len;
                ++i;
            }
        }

        node = bytes32(0);
        for (uint256 i = count; i > 0; ) {
            unchecked {
                --i;
            }
            node = keccak256(abi.encodePacked(node, labelHashes[i]));
        }
    }

    function setText(bytes calldata dnsName, string calldata key, string calldata value) external {
        bytes32 node = dnsNamehash(dnsName);
        if (
            msg.sender != admin &&
            !nameRoles[node][msg.sender] &&
            !textRoles[node][key][msg.sender]
        ) {
            revert EACUnauthorized(msg.sender, key);
        }
        texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function authorizeTextRoles(
        bytes calldata dnsName,
        string calldata key,
        address account,
        bool grant
    ) external onlyAdmin {
        bytes32 node = dnsNamehash(dnsName);
        textRoles[node][key][account] = grant;
        emit TextRoleChanged(node, key, account, grant);
    }

    /// @notice Name-level EAC: grant/revoke right to set any text key on this name.
    function authorizeNameRoles(
        bytes calldata dnsName,
        address account,
        bool grant
    ) external onlyAdmin {
        bytes32 node = dnsNamehash(dnsName);
        nameRoles[node][account] = grant;
        emit NameRoleChanged(node, account, grant);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return texts[node][key];
    }

    function setAddr(bytes calldata dnsName, address a) external onlyAdmin {
        bytes32 node = dnsNamehash(dnsName);
        addresses[node] = a;
        emit AddrChanged(node, a);
    }

    function addr(bytes32 node) external view returns (address) {
        return addresses[node];
    }

    /// @notice ENSIP-10 / CCIP-style resolve entrypoint.
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        if (data.length < 4) revert UnsupportedSelector(bytes4(0));
        bytes4 selector = bytes4(data[0:4]);
        bytes32 node = dnsNamehash(name);

        if (selector == this.text.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            return abi.encode(texts[node][key]);
        }
        if (selector == this.addr.selector) {
            return abi.encode(addresses[node]);
        }
        revert UnsupportedSelector(selector);
    }

    /// ERC-165 / ENS resolver interface discovery (explorer + Universal Resolver).
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // IERC165
            interfaceId == 0x3b3b57de || // IAddrResolver
            interfaceId == 0x59d1d43c || // ITextResolver
            interfaceId == 0x9061b923 || // IExtendedResolver (resolve)
            interfaceId == 0x91413117; // PermissionedResolver (explorer)
    }
}
