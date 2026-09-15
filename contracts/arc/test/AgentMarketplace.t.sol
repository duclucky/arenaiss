// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AgentRegistryV2.sol";
import "../AgentMarketplace.sol";
import "./TestBase.sol";

contract MarketplaceMockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; return true; }
    function transfer(address to, uint256 value) external returns (bool) { require(balanceOf[msg.sender] >= value); balanceOf[msg.sender] -= value; balanceOf[to] += value; return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) { require(allowance[from][msg.sender] >= value && balanceOf[from] >= value); allowance[from][msg.sender] -= value; balanceOf[from] -= value; balanceOf[to] += value; return true; }
}

contract AgentMarketplaceTest is TestBase {
    address constant SELLER = address(0xA11CE); address constant BUYER = address(0xB0B); address constant TREASURY = address(0xFEE);
    bytes32 constant AGENT = keccak256("agent"); bytes32 constant VERSION = keccak256("v1"); bytes32 constant COMMITMENT = keccak256("content"); bytes32 constant CERT = keccak256("certificate");
    AgentRegistryV2 registry; AgentMarketplace market; MarketplaceMockUSDC usdc;
    function setUp() public {
        usdc = new MarketplaceMockUSDC(); registry = new AgentRegistryV2(address(this)); market = new AgentMarketplace(address(usdc), address(registry), address(this), TREASURY);
        registry.configureMarketplace(address(market)); vm.prank(SELLER); registry.registerAgent(AGENT, VERSION, COMMITMENT);
        market.approveEligibility(CERT, AGENT, VERSION, COMMITMENT, 2000); vm.prank(SELLER); market.createListing(AGENT, VERSION, COMMITMENT, CERT, 1_000_000, 1900);
        usdc.mint(BUYER, 1_000_000); vm.prank(BUYER); usdc.approve(address(market), 1_000_000); vm.warp(1500);
    }
    function testPurchaseChargesFixedOnePercentAndTransfersOwnership() public {
        vm.prank(BUYER); market.buy(1);
        assertEq(market.creditOf(SELLER), 990_000); assertEq(market.creditOf(TREASURY), 10_000);
        (address owner,,, bool active) = registry.agents(AGENT); assertEq(owner, BUYER); assertTrue(active);
        vm.prank(SELLER); market.withdraw(); vm.prank(TREASURY); market.withdraw(); assertEq(usdc.balanceOf(address(market)), 0);
    }
    function testOnlyOwnerCanListAndOnlyOperatorCanApprove() public {
        vm.prank(BUYER); vm.expectRevert(AgentMarketplace.UnauthorizedOperator.selector); market.approveEligibility(bytes32(uint256(2)), AGENT, VERSION, COMMITMENT, 2000);
        vm.prank(BUYER); vm.expectRevert(AgentMarketplace.UnauthorizedSeller.selector); market.createListing(AGENT, VERSION, COMMITMENT, CERT, 2_000_000, 1900);
    }
    function testExpiredCancelledAndDuplicatePurchasesFailClosed() public {
        vm.prank(SELLER); market.cancel(1); vm.prank(BUYER); vm.expectRevert(AgentMarketplace.ListingUnavailable.selector); market.buy(1);
        market.approveEligibility(bytes32(uint256(3)), AGENT, VERSION, COMMITMENT, 2000); vm.prank(SELLER); market.createListing(AGENT, VERSION, COMMITMENT, bytes32(uint256(3)), 1_000_000, 1600);
        vm.warp(1601); vm.prank(BUYER); vm.expectRevert(AgentMarketplace.ListingExpired.selector); market.buy(2);
    }
}
