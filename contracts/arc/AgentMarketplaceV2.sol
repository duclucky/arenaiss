// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IMarketplaceV2Token {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC8004IdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @notice Arc USDC marketplace whose sole ownership authority is the official
/// ERC-8004 Identity Registry. Eligibility is operator-approved, exact-bound,
/// and single-use; a purchase atomically exchanges USDC and the identity NFT.
contract AgentMarketplaceV2 {
    error InvalidAddress();
    error InvalidListing();
    error InvalidEligibility();
    error UnauthorizedOperator();
    error UnauthorizedSeller();
    error ListingUnavailable();
    error ListingExpired();
    error TokenTransferFailed();
    error NoCredit();
    error Reentrancy();
    error MarketplaceNotApproved();

    enum ListingState { NONE, ACTIVE, SOLD, CANCELLED }

    struct Eligibility {
        uint256 tokenId;
        bytes32 agentId;
        bytes32 version;
        bytes32 commitment;
        uint64 validUntil;
        bool consumed;
    }

    struct Listing {
        uint256 tokenId;
        bytes32 agentId;
        bytes32 version;
        bytes32 commitment;
        bytes32 eligibilityDigest;
        address seller;
        uint128 price;
        uint64 expiresAt;
        ListingState state;
    }

    uint256 public constant PLATFORM_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IMarketplaceV2Token public immutable usdc;
    IERC8004IdentityRegistry public immutable identityRegistry;
    address public immutable operator;
    address public immutable platformRecipient;

    uint256 public nextListingId = 1;
    uint256 private entered;
    mapping(bytes32 => Eligibility) public eligibility;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public creditOf;

    event EligibilityApproved(bytes32 indexed digest, uint256 indexed tokenId, bytes32 indexed agentId, bytes32 version, bytes32 commitment, uint64 validUntil);
    event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, bytes32 indexed agentId, address seller, uint256 price, uint64 expiresAt, bytes32 eligibilityDigest);
    event ListingCancelled(uint256 indexed listingId);
    event ListingSold(uint256 indexed listingId, address indexed buyer, uint256 sellerCredit, uint256 platformCredit);
    event CreditWithdrawn(address indexed beneficiary, uint256 amount);

    modifier nonReentrant() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address usdc_, address identityRegistry_, address operator_, address platformRecipient_) {
        if (usdc_ == address(0) || identityRegistry_ == address(0) || operator_ == address(0) || platformRecipient_ == address(0)) revert InvalidAddress();
        usdc = IMarketplaceV2Token(usdc_);
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        operator = operator_;
        platformRecipient = platformRecipient_;
    }

    function approveEligibility(bytes32 digest, uint256 tokenId, bytes32 agentId, bytes32 version, bytes32 commitment, uint64 validUntil) external {
        if (msg.sender != operator) revert UnauthorizedOperator();
        if (digest == bytes32(0) || tokenId == 0 || agentId == bytes32(0) || version == bytes32(0) || commitment == bytes32(0)
            || validUntil <= block.timestamp || eligibility[digest].agentId != bytes32(0)) revert InvalidEligibility();
        eligibility[digest] = Eligibility(tokenId, agentId, version, commitment, validUntil, false);
        emit EligibilityApproved(digest, tokenId, agentId, version, commitment, validUntil);
    }

    function createListing(uint256 tokenId, bytes32 agentId, bytes32 version, bytes32 commitment, bytes32 eligibilityDigest, uint128 price, uint64 expiresAt) external returns (uint256 listingId) {
        address owner = identityRegistry.ownerOf(tokenId);
        if (owner != msg.sender) revert UnauthorizedSeller();
        if (identityRegistry.getApproved(tokenId) != address(this) && !identityRegistry.isApprovedForAll(owner, address(this))) revert MarketplaceNotApproved();
        if (price == 0 || expiresAt <= block.timestamp) revert InvalidListing();

        Eligibility storage approved = eligibility[eligibilityDigest];
        if (approved.consumed || approved.validUntil < expiresAt || approved.tokenId != tokenId || approved.agentId != agentId
            || approved.version != version || approved.commitment != commitment) revert InvalidEligibility();

        approved.consumed = true;
        listingId = nextListingId++;
        listings[listingId] = Listing(tokenId, agentId, version, commitment, eligibilityDigest, msg.sender, price, expiresAt, ListingState.ACTIVE);
        emit ListingCreated(listingId, tokenId, agentId, msg.sender, price, expiresAt, eligibilityDigest);
    }

    function cancel(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.state != ListingState.ACTIVE) revert ListingUnavailable();
        if (listing.seller != msg.sender) revert UnauthorizedSeller();
        listing.state = ListingState.CANCELLED;
        emit ListingCancelled(listingId);
    }

    function buy(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.state != ListingState.ACTIVE) revert ListingUnavailable();
        if (block.timestamp > listing.expiresAt) revert ListingExpired();
        if (msg.sender == listing.seller) revert UnauthorizedSeller();

        uint256 price = listing.price;
        uint256 fee = price * PLATFORM_FEE_BPS / BPS_DENOMINATOR;
        uint256 sellerCredit = price - fee;
        address seller = listing.seller;

        listing.state = ListingState.SOLD;
        creditOf[seller] += sellerCredit;
        creditOf[platformRecipient] += fee;

        if (!usdc.transferFrom(msg.sender, address(this), price)) revert TokenTransferFailed();
        identityRegistry.transferFrom(seller, msg.sender, listing.tokenId);
        emit ListingSold(listingId, msg.sender, sellerCredit, fee);
    }

    function withdraw() external nonReentrant {
        uint256 amount = creditOf[msg.sender];
        if (amount == 0) revert NoCredit();
        creditOf[msg.sender] = 0;
        if (!usdc.transfer(msg.sender, amount)) revert TokenTransferFailed();
        emit CreditWithdrawn(msg.sender, amount);
    }
}
