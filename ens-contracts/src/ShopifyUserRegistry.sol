// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ENSv2 IRegistry + explorer-compatible PermissionedRegistry shims.
 * Hackathon UserRegistryImpl lacks initialize(); this is the demo substitute.
 *
 * Explorer needs ownerOf/getStatus/getTokenId + official LabelRegistered /
 * SubregistryUpdated events. Universal Resolver only needs getSubregistry /
 * getResolver / getParent — those work too.
 */
contract ShopifyUserRegistry {
    // Status codes aligned with ETH registry observations (2 = registered).
    uint8 public constant STATUS_NONE = 0;
    uint8 public constant STATUS_REGISTERED = 2;

    bytes4 private constant IERC165_ID = 0x01ffc9a7;
    bytes4 private constant IREGISTRY_ID = 0x51f67f40;
    /// IOwnedRegistry — required by ensUniversalHelper.findExactOwner
    bytes4 private constant IOWNED_REGISTRY_ID = 0x63560a8e;

    address public immutable admin;
    address public immutable parentRegistry;
    string public parentLabel;

    mapping(string => address) internal _owners;
    mapping(string => address) internal _resolvers;
    mapping(string => address) internal _subregistries;
    mapping(string => uint64) internal _expiries;
    mapping(string => uint256) internal _roleBitmaps;
    /// tokenId (labelhash with low 32 bits cleared) → label
    mapping(uint256 => string) internal _labelOfToken;

    event LabelRegistered(
        uint256 indexed tokenId,
        bytes32 indexed labelHash,
        string label,
        address owner,
        uint64 expires,
        address indexed registrant
    );
    event SubregistryUpdated(
        uint256 indexed tokenId,
        address indexed subregistry,
        address indexed sender
    );
    event ResolverUpdated(uint256 indexed tokenId, address indexed resolver, address indexed sender);

    error NotAdmin();
    error EmptyLabel();
    error ZeroOwner();
    error UnknownToken();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_, address parentRegistry_, string memory parentLabel_) {
        require(admin_ != address(0) && parentRegistry_ != address(0), "zero");
        admin = admin_;
        parentRegistry = parentRegistry_;
        parentLabel = parentLabel_;
    }

    /// @dev ENSv2 label token id: keccak256(label) with last 4 bytes zeroed.
    function labelTokenId(string memory label) public pure returns (uint256) {
        return uint256(keccak256(bytes(label))) & ~uint256(0xffffffff);
    }

    function getTokenId(uint256 id) external pure returns (uint256) {
        return id & ~uint256(0xffffffff);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == IERC165_ID ||
            interfaceId == IREGISTRY_ID ||
            interfaceId == IOWNED_REGISTRY_ID;
    }

    /// @notice IOwnedRegistry — explorer / UniversalHelper ownership walk.
    function findOwner(string calldata label) external view returns (address) {
        return _owners[label];
    }

    function getSubregistry(string calldata label) external view returns (address) {
        return _subregistries[label];
    }

    function getResolver(string calldata label) external view returns (address) {
        return _resolvers[label];
    }

    function getParent() external view returns (address parent, string memory label) {
        return (parentRegistry, parentLabel);
    }

    function ownerOfLabel(string calldata label) external view returns (address) {
        return _owners[label];
    }

    function getOwner(string calldata label) external view returns (address) {
        return _owners[label];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        string memory label = _labelOfToken[tokenId & ~uint256(0xffffffff)];
        if (bytes(label).length == 0) revert UnknownToken();
        return _owners[label];
    }

    function getOwner(uint256 tokenId) external view returns (address) {
        string memory label = _labelOfToken[tokenId & ~uint256(0xffffffff)];
        if (bytes(label).length == 0) revert UnknownToken();
        return _owners[label];
    }

    function getStatus(uint256 tokenId) external view returns (uint8) {
        string memory label = _labelOfToken[tokenId & ~uint256(0xffffffff)];
        if (bytes(label).length == 0 || _owners[label] == address(0)) return STATUS_NONE;
        return STATUS_REGISTERED;
    }

    function getExpiry(uint256 tokenId) external view returns (uint64) {
        string memory label = _labelOfToken[tokenId & ~uint256(0xffffffff)];
        if (bytes(label).length == 0) return 0;
        return _expiries[label];
    }

    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external onlyAdmin returns (uint256 tokenId) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (owner == address(0)) revert ZeroOwner();

        bytes32 labelHash = keccak256(bytes(label));
        tokenId = uint256(labelHash) & ~uint256(0xffffffff);

        _owners[label] = owner;
        _resolvers[label] = resolver;
        _subregistries[label] = registry;
        _roleBitmaps[label] = roleBitmap;
        _expiries[label] = expiry;
        _labelOfToken[tokenId] = label;

        emit LabelRegistered(tokenId, labelHash, label, owner, expiry, msg.sender);
        emit ResolverUpdated(tokenId, resolver, msg.sender);
        if (registry != address(0)) {
            emit SubregistryUpdated(tokenId, registry, msg.sender);
        }
    }

    /// @notice Update subregistry after register (emits explorer event).
    function setSubregistry(uint256 tokenId, address registry) external onlyAdmin {
        uint256 tid = tokenId & ~uint256(0xffffffff);
        string memory label = _labelOfToken[tid];
        if (bytes(label).length == 0) revert UnknownToken();
        _subregistries[label] = registry;
        emit SubregistryUpdated(tid, registry, msg.sender);
    }

    function setResolver(uint256 tokenId, address resolver) external onlyAdmin {
        uint256 tid = tokenId & ~uint256(0xffffffff);
        string memory label = _labelOfToken[tid];
        if (bytes(label).length == 0) revert UnknownToken();
        _resolvers[label] = resolver;
        emit ResolverUpdated(tid, resolver, msg.sender);
    }
}
