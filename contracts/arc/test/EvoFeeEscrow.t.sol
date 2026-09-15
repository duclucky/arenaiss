// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./TestBase.sol";
import "../EvoFeeEscrow.sol";

contract EvoMockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { require(balanceOf[msg.sender] >= amount); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount); allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}

contract EvoFeeEscrowTest is TestBase {
    EvoMockUsdc token;
    EvoFeeEscrow escrow;
    address constant OPERATOR = address(0xA11CE);
    address constant RECIPIENT = address(0xFEE);
    address constant PAYER = address(0xB0B);
    bytes32 constant CAMPAIGN = bytes32(uint256(1));

    function setUp() public {
        token = new EvoMockUsdc();
        escrow = new EvoFeeEscrow(address(token), OPERATOR, RECIPIENT, 1_000_000, 1 days);
        token.mint(PAYER, 2_000_000);
        vm.prank(PAYER); token.approve(address(escrow), 2_000_000);
    }

    function testDepositAndReleaseExactlyOnce() public {
        vm.prank(PAYER); escrow.deposit(CAMPAIGN);
        assertEq(token.balanceOf(address(escrow)), 1_000_000);
        vm.prank(OPERATOR); escrow.release(CAMPAIGN);
        assertEq(token.balanceOf(RECIPIENT), 1_000_000);
        vm.prank(OPERATOR); vm.expectRevert(EvoFeeEscrow.PaymentUnavailable.selector); escrow.release(CAMPAIGN);
        vm.prank(OPERATOR); vm.expectRevert(EvoFeeEscrow.PaymentUnavailable.selector); escrow.refund(CAMPAIGN);
    }

    function testInfrastructureRefundReturnsTheHeldFee() public {
        vm.prank(PAYER); escrow.deposit(CAMPAIGN);
        vm.prank(address(0xBAD)); vm.expectRevert(EvoFeeEscrow.UnauthorizedOperator.selector); escrow.refund(CAMPAIGN);
        vm.prank(OPERATOR); escrow.refund(CAMPAIGN);
        assertEq(token.balanceOf(PAYER), 2_000_000);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testPayerCanRecoverAfterTimeoutOnly() public {
        vm.prank(PAYER); escrow.deposit(CAMPAIGN);
        vm.prank(PAYER); vm.expectRevert(EvoFeeEscrow.RefundTooEarly.selector); escrow.claimTimeoutRefund(CAMPAIGN);
        vm.warp(block.timestamp + 1 days);
        vm.prank(address(0xBAD)); vm.expectRevert(EvoFeeEscrow.UnauthorizedPayer.selector); escrow.claimTimeoutRefund(CAMPAIGN);
        vm.prank(PAYER); escrow.claimTimeoutRefund(CAMPAIGN);
        assertEq(token.balanceOf(PAYER), 2_000_000);
    }

    function testDuplicateOrEmptyCampaignCannotDeposit() public {
        vm.prank(PAYER); vm.expectRevert(EvoFeeEscrow.InvalidCampaign.selector); escrow.deposit(bytes32(0));
        vm.prank(PAYER); escrow.deposit(CAMPAIGN);
        vm.prank(PAYER); vm.expectRevert(EvoFeeEscrow.PaymentUnavailable.selector); escrow.deposit(CAMPAIGN);
    }
}
