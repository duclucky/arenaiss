// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../PairMatchEscrow.sol";
import "./TestBase.sol";

contract PairUsdcMock {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public rejectTransfer;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (rejectTransfer) return false;
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "funds");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (rejectTransfer) return false;
        require(balanceOf[msg.sender] >= amount, "funds");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function setRejectTransfer(bool value) external {
        rejectTransfer = value;
    }
}

contract PairMatchEscrowTest is TestBase {
    PairUsdcMock token;
    PairMatchEscrow escrow;
    address constant OPERATOR = address(0x1001);
    address constant ALICE = address(0x2001);
    address constant BOB = address(0x2002);
    address constant EVE = address(0x2003);
    bytes32 constant ROOM = keccak256("room");
    bytes32 constant AGENT_A = keccak256("agent-a");
    bytes32 constant AGENT_B = keccak256("agent-b");
    uint128 constant STAKE = 1_000_000;

    function setUp() public {
        token = new PairUsdcMock();
        escrow = new PairMatchEscrow(address(token), OPERATOR);
        vm.warp(100);
        token.mint(ALICE, 5_000_000);
        token.mint(BOB, 5_000_000);
        vm.prank(ALICE);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(escrow), type(uint256).max);
    }

    function _create() internal {
        vm.prank(ALICE);
        escrow.createRoom(ROOM, AGENT_A, STAKE, 200, 500);
    }

    function _join() internal {
        vm.prank(BOB);
        escrow.joinRoom(ROOM, AGENT_B);
    }

    function testCreateRequiresFundsAndApprovalAtomically() public {
        vm.prank(EVE);
        vm.expectRevert(PairMatchEscrow.InsufficientBalance.selector);
        escrow.createRoom(ROOM, AGENT_A, STAKE, 200, 500);
        token.mint(EVE, STAKE);
        vm.prank(EVE);
        vm.expectRevert(PairMatchEscrow.InsufficientAllowance.selector);
        escrow.createRoom(ROOM, AGENT_A, STAKE, 200, 500);
        assertEq(uint256(escrow.getRoom(ROOM).state), 0);
        assertEq(escrow.totalLiability(), 0);
        _create();
        assertEq(token.balanceOf(address(escrow)), STAKE);
        assertEq(escrow.totalLiability(), STAKE);
        vm.expectRevert(PairMatchEscrow.Duplicate.selector);
        _create();
    }

    function testJoinLocksMatchingStakeAndRejectsWrongParticipantOrLateJoin() public {
        _create();
        vm.prank(ALICE);
        vm.expectRevert(PairMatchEscrow.InvalidRoom.selector);
        escrow.joinRoom(ROOM, AGENT_B);
        vm.prank(BOB);
        vm.expectRevert(PairMatchEscrow.InvalidRoom.selector);
        escrow.joinRoom(ROOM, AGENT_A);
        _join();
        assertEq(escrow.totalLiability(), STAKE * 2);
        assertEq(token.balanceOf(address(escrow)), STAKE * 2);
        vm.prank(EVE);
        vm.expectRevert(PairMatchEscrow.InvalidState.selector);
        escrow.joinRoom(ROOM, keccak256("third"));
        assertEq(escrow.getRoom(ROOM).challenger, BOB);
    }

    function testInsufficientChallengerBalanceCannotJoinOrChangeLiability() public {
        _create();
        vm.prank(EVE);
        vm.expectRevert(PairMatchEscrow.InsufficientBalance.selector);
        escrow.joinRoom(ROOM, AGENT_B);
        assertEq(uint256(escrow.getRoom(ROOM).state), 1);
        assertEq(escrow.totalLiability(), STAKE);
        assertEq(token.balanceOf(address(escrow)), STAKE);
        _join();
        assertEq(escrow.totalLiability(), STAKE * 2);
    }

    function testCreatorCancelBeforeJoinRefundsExactlyOnce() public {
        _create();
        vm.prank(ALICE);
        escrow.cancelRoom(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), STAKE);
        vm.prank(ALICE);
        escrow.withdraw(ROOM);
        assertEq(token.balanceOf(ALICE), 5_000_000);
        assertEq(escrow.totalLiability(), 0);
        vm.prank(ALICE);
        vm.expectRevert(PairMatchEscrow.NoCredit.selector);
        escrow.withdraw(ROOM);
        vm.prank(BOB);
        vm.expectRevert(PairMatchEscrow.InvalidState.selector);
        escrow.joinRoom(ROOM, AGENT_B);
    }

    function testJoinedRoomNeedsBothCancelRequestsThenRefundsBoth() public {
        _create();
        _join();
        vm.prank(ALICE);
        vm.expectRevert(PairMatchEscrow.Unauthorized.selector);
        escrow.cancelRoom(ROOM);
        vm.prank(ALICE);
        escrow.requestCancel(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), 0);
        vm.prank(BOB);
        escrow.requestCancel(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), STAKE);
        assertEq(escrow.creditOf(ROOM, BOB), STAKE);
        vm.prank(ALICE);
        escrow.withdraw(ROOM);
        vm.prank(BOB);
        escrow.withdraw(ROOM);
        assertEq(escrow.totalLiability(), 0);
        assertEq(token.balanceOf(ALICE), 5_000_000);
        assertEq(token.balanceOf(BOB), 5_000_000);
    }

    function testOperatorOnlySettlesToPlayerAndWinnerClaimsBothStakes() public {
        _create();
        _join();
        vm.prank(EVE);
        vm.expectRevert(PairMatchEscrow.Unauthorized.selector);
        escrow.settle(ROOM, EVE, keccak256("verdict"));
        vm.prank(OPERATOR);
        vm.expectRevert(PairMatchEscrow.InvalidRoom.selector);
        escrow.settle(ROOM, EVE, keccak256("verdict"));
        vm.prank(OPERATOR);
        escrow.settle(ROOM, BOB, keccak256("verdict"));
        assertEq(escrow.creditOf(ROOM, BOB), STAKE * 2);
        vm.prank(BOB);
        escrow.withdraw(ROOM);
        assertEq(token.balanceOf(BOB), 6_000_000);
        assertEq(token.balanceOf(ALICE), 4_000_000);
        assertEq(escrow.totalLiability(), 0);
        vm.prank(OPERATOR);
        vm.expectRevert(PairMatchEscrow.InvalidState.selector);
        escrow.settle(ROOM, ALICE, keccak256("second"));
    }

    function testTimeoutRefundAndFailedWithdrawalKeepFundsAccounted() public {
        _create();
        _join();
        vm.expectRevert(PairMatchEscrow.Deadline.selector);
        escrow.expireRoom(ROOM);
        vm.warp(500);
        escrow.expireRoom(ROOM);
        token.setRejectTransfer(true);
        vm.prank(ALICE);
        vm.expectRevert(PairMatchEscrow.TransferFailed.selector);
        escrow.withdraw(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), STAKE);
        assertEq(escrow.totalLiability(), STAKE * 2);
        token.setRejectTransfer(false);
        vm.prank(ALICE);
        escrow.withdraw(ROOM);
        vm.prank(BOB);
        escrow.withdraw(ROOM);
        assertEq(escrow.totalLiability(), 0);
    }

    function testUnjoinedRoomExpiresAfterJoinDeadline() public {
        _create();
        vm.warp(200);
        vm.prank(BOB);
        vm.expectRevert(PairMatchEscrow.Deadline.selector);
        escrow.joinRoom(ROOM, AGENT_B);
        escrow.expireRoom(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), STAKE);
    }

    function testOperatorCannotSettleAfterResolutionDeadline() public {
        _create();
        _join();
        vm.warp(500);
        vm.prank(OPERATOR);
        vm.expectRevert(PairMatchEscrow.Deadline.selector);
        escrow.settle(ROOM, BOB, keccak256("verdict"));
        escrow.expireRoom(ROOM);
        assertEq(escrow.creditOf(ROOM, ALICE), STAKE);
        assertEq(escrow.creditOf(ROOM, BOB), STAKE);
    }
}
