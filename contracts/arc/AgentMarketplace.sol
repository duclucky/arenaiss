// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IMarketplaceToken { function transfer(address to, uint256 amount) external returns (bool); function transferFrom(address from, address to, uint256 amount) external returns (bool); }
interface IMarketplaceRegistry { function agents(bytes32 agentId) external view returns (address, bytes32, bytes32, bool); function transferAgent(bytes32 agentId, bytes32 version, bytes32 commitment, address from, address to) external; }

contract AgentMarketplace {
    error InvalidAddress(); error InvalidListing(); error InvalidEligibility(); error UnauthorizedOperator(); error UnauthorizedSeller(); error ListingUnavailable(); error ListingExpired(); error TokenTransferFailed(); error NoCredit(); error Reentrancy();
    uint256 public constant PLATFORM_FEE_BPS = 100; uint256 public constant BPS_DENOMINATOR = 10_000;
    enum ListingState { NONE, ACTIVE, SOLD, CANCELLED }
    struct Eligibility { bytes32 agentId; bytes32 version; bytes32 commitment; uint64 validUntil; bool consumed; }
    struct Listing { bytes32 agentId; bytes32 version; bytes32 commitment; bytes32 eligibilityDigest; address seller; uint128 price; uint64 expiresAt; ListingState state; }
    IMarketplaceToken public immutable usdc; IMarketplaceRegistry public immutable registry; address public immutable operator; address public immutable platformRecipient;
    uint256 public nextListingId = 1; uint256 private entered;
    mapping(bytes32 => Eligibility) public eligibility; mapping(uint256 => Listing) public listings; mapping(address => uint256) public creditOf;
    event EligibilityApproved(bytes32 indexed digest, bytes32 indexed agentId, bytes32 indexed version, bytes32 commitment, uint64 validUntil);
    event ListingCreated(uint256 indexed listingId, bytes32 indexed agentId, address indexed seller, uint256 price, uint64 expiresAt, bytes32 eligibilityDigest);
    event ListingCancelled(uint256 indexed listingId); event ListingSold(uint256 indexed listingId, address indexed buyer, uint256 sellerCredit, uint256 platformCredit); event CreditWithdrawn(address indexed beneficiary, uint256 amount);
    modifier nonReentrant() { if (entered != 0) revert Reentrancy(); entered = 1; _; entered = 0; }
    constructor(address usdc_, address registry_, address operator_, address platformRecipient_) { if (usdc_ == address(0) || registry_ == address(0) || operator_ == address(0) || platformRecipient_ == address(0)) revert InvalidAddress(); usdc = IMarketplaceToken(usdc_); registry = IMarketplaceRegistry(registry_); operator = operator_; platformRecipient = platformRecipient_; }
    function approveEligibility(bytes32 digest, bytes32 agentId, bytes32 version, bytes32 commitment, uint64 validUntil) external { if (msg.sender != operator) revert UnauthorizedOperator(); if (digest == bytes32(0) || agentId == bytes32(0) || version == bytes32(0) || commitment == bytes32(0) || validUntil <= block.timestamp || eligibility[digest].agentId != bytes32(0)) revert InvalidEligibility(); eligibility[digest] = Eligibility(agentId, version, commitment, validUntil, false); emit EligibilityApproved(digest, agentId, version, commitment, validUntil); }
    function createListing(bytes32 agentId, bytes32 version, bytes32 commitment, bytes32 eligibilityDigest, uint128 price, uint64 expiresAt) external returns (uint256 listingId) {
        (address owner, bytes32 currentVersion, bytes32 currentCommitment, bool active) = registry.agents(agentId); if (owner != msg.sender || !active) revert UnauthorizedSeller();
        if (price == 0 || expiresAt <= block.timestamp) revert InvalidListing(); Eligibility storage approved = eligibility[eligibilityDigest];
        if (approved.consumed || approved.validUntil < expiresAt || approved.agentId != agentId || approved.version != version || approved.commitment != commitment || currentVersion != version || currentCommitment != commitment) revert InvalidEligibility();
        approved.consumed = true; listingId = nextListingId++; listings[listingId] = Listing(agentId, version, commitment, eligibilityDigest, msg.sender, price, expiresAt, ListingState.ACTIVE); emit ListingCreated(listingId, agentId, msg.sender, price, expiresAt, eligibilityDigest);
    }
    function cancel(uint256 listingId) external { Listing storage listing = listings[listingId]; if (listing.state != ListingState.ACTIVE) revert ListingUnavailable(); if (listing.seller != msg.sender) revert UnauthorizedSeller(); listing.state = ListingState.CANCELLED; emit ListingCancelled(listingId); }
    function buy(uint256 listingId) external nonReentrant { Listing storage listing = listings[listingId]; if (listing.state != ListingState.ACTIVE) revert ListingUnavailable(); if (block.timestamp > listing.expiresAt) revert ListingExpired(); if (msg.sender == listing.seller) revert UnauthorizedSeller();
        uint256 price = listing.price; if (!usdc.transferFrom(msg.sender, address(this), price)) revert TokenTransferFailed(); registry.transferAgent(listing.agentId, listing.version, listing.commitment, listing.seller, msg.sender);
        listing.state = ListingState.SOLD; uint256 fee = price * PLATFORM_FEE_BPS / BPS_DENOMINATOR; uint256 sellerCredit = price - fee; creditOf[listing.seller] += sellerCredit; creditOf[platformRecipient] += fee; emit ListingSold(listingId, msg.sender, sellerCredit, fee);
    }
    function withdraw() external nonReentrant { uint256 amount = creditOf[msg.sender]; if (amount == 0) revert NoCredit(); creditOf[msg.sender] = 0; if (!usdc.transfer(msg.sender, amount)) revert TokenTransferFailed(); emit CreditWithdrawn(msg.sender, amount); }
}
