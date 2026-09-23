// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AgentMarketplaceV2.sol";
import "./TestBase.sol";

contract MarketplaceV2MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfer;

    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function setFailTransfer(bool value) external { failTransfer = value; }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transfer(address to, uint256 value) external returns (bool) {
        if (failTransfer) return false;
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value; balanceOf[to] += value; return true;
    }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (failTransfer) return false;
        require(allowance[from][msg.sender] >= value && balanceOf[from] >= value, "allowance/balance");
        allowance[from][msg.sender] -= value; balanceOf[from] -= value; balanceOf[to] += value; return true;
    }
}

contract MarketplaceV2MockIdentityRegistry {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) private operators;
    bool public failTransfer;

    function mint(address owner, uint256 tokenId) external { ownerOf[tokenId] = owner; }
    function approve(address approved, uint256 tokenId) external { require(ownerOf[tokenId] == msg.sender, "owner"); getApproved[tokenId] = approved; }
    function setApprovalForAll(address operator, bool approved) external { operators[msg.sender][operator] = approved; }
    function isApprovedForAll(address owner, address operator) external view returns (bool) { return operators[owner][operator]; }
    function setFailTransfer(bool value) external { failTransfer = value; }
    function transferFrom(address from, address to, uint256 tokenId) external {
        require(!failTransfer, "transfer failed");
        require(ownerOf[tokenId] == from, "from");
        require(msg.sender == from || getApproved[tokenId] == msg.sender || operators[from][msg.sender], "approval");
        ownerOf[tokenId] = to; getApproved[tokenId] = address(0);
    }
}

contract AgentMarketplaceV2Test is TestBase {
    address constant SELLER = address(0xA11CE);
    address constant BUYER = address(0xB0B);
    address constant TREASURY = address(0xFEE);
    uint256 constant TOKEN_ID = 896814;
    bytes32 constant AGENT = keccak256("agent");
    bytes32 constant VERSION = keccak256("v1");
    bytes32 constant COMMITMENT = keccak256("content");
    bytes32 constant CERT = keccak256("certificate");

    MarketplaceV2MockUSDC usdc;
    MarketplaceV2MockIdentityRegistry registry;
    AgentMarketplaceV2 market;

    function setUp() public {
        vm.warp(1000);
        usdc = new MarketplaceV2MockUSDC();
        registry = new MarketplaceV2MockIdentityRegistry();
        market = new AgentMarketplaceV2(address(usdc), address(registry), address(this), TREASURY);
        registry.mint(SELLER, TOKEN_ID);
        market.approveEligibility(CERT, TOKEN_ID, AGENT, VERSION, COMMITMENT, 2000);
        usdc.mint(BUYER, 1_000_000);
        vm.prank(BUYER); usdc.approve(address(market), 1_000_000);
    }

    function approveAndList() internal returns (uint256) {
        vm.prank(SELLER); registry.approve(address(market), TOKEN_ID);
        vm.prank(SELLER); return market.createListing(TOKEN_ID, AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
    }

    function testPurchaseAtomicallyTransfersIdentityAndCreditsUSDC() public {
        uint256 listingId = approveAndList();
        vm.prank(BUYER); market.buy(listingId);
        assertEq(registry.ownerOf(TOKEN_ID), BUYER);
        assertEq(market.creditOf(SELLER), 990_000);
        assertEq(market.creditOf(TREASURY), 10_000);
        vm.prank(SELLER); market.withdraw();
        vm.prank(TREASURY); market.withdraw();
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function testListingRequiresCanonicalOwnerAndMarketplaceApproval() public {
        vm.prank(BUYER); vm.expectRevert(AgentMarketplaceV2.UnauthorizedSeller.selector);
        market.createListing(TOKEN_ID, AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
        vm.prank(SELLER); vm.expectRevert(AgentMarketplaceV2.MarketplaceNotApproved.selector);
        market.createListing(TOKEN_ID, AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
    }

    function testEligibilityIsExactBoundAndSingleUse() public {
        vm.prank(SELLER); registry.approve(address(market), TOKEN_ID);
        vm.prank(SELLER); vm.expectRevert(AgentMarketplaceV2.InvalidEligibility.selector);
        market.createListing(TOKEN_ID, AGENT, keccak256("other"), COMMITMENT, CERT, 1_000_000, 1900);
        vm.prank(SELLER); market.createListing(TOKEN_ID, AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
        vm.prank(SELLER); vm.expectRevert(AgentMarketplaceV2.InvalidEligibility.selector);
        market.createListing(TOKEN_ID, AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
    }

    function testOnlyOperatorCanApproveEligibility() public {
        vm.prank(BUYER); vm.expectRevert(AgentMarketplaceV2.UnauthorizedOperator.selector);
        market.approveEligibility(keccak256("other"), TOKEN_ID, AGENT, VERSION, COMMITMENT, 2000);
    }

    function testNftTransferFailureRollsBackUsdcAndListingState() public {
        uint256 listingId = approveAndList();
        registry.setFailTransfer(true);
        vm.prank(BUYER); vm.expectRevert(); market.buy(listingId);
        assertEq(usdc.balanceOf(BUYER), 1_000_000);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(market.creditOf(SELLER), 0);
        (,,,,,,,, AgentMarketplaceV2.ListingState state) = market.listings(listingId);
        assertEq(uint256(state), uint256(AgentMarketplaceV2.ListingState.ACTIVE));
    }

    function testExpiredCancelledAndDuplicatePurchasesFailClosed() public {
        uint256 listingId = approveAndList();
        vm.prank(SELLER); market.cancel(listingId);
        vm.prank(BUYER); vm.expectRevert(AgentMarketplaceV2.ListingUnavailable.selector); market.buy(listingId);

        bytes32 cert2 = keccak256("certificate2"); uint256 token2 = TOKEN_ID + 1;
        registry.mint(SELLER, token2); market.approveEligibility(cert2, token2, AGENT, VERSION, COMMITMENT, 2000);
        vm.prank(SELLER); registry.approve(address(market), token2);
        vm.prank(SELLER); uint256 listing2 = market.createListing(token2, AGENT, VERSION, COMMITMENT, cert2, 1_000_000, 1600);
        vm.warp(1601); vm.prank(BUYER); vm.expectRevert(AgentMarketplaceV2.ListingExpired.selector); market.buy(listing2);
    }
}
