// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../TournamentEscrow.sol";
import "./TestBase.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "funds");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "funds");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TournamentEscrowTest is TestBase {
    MockUSDC token;
    TournamentEscrow escrow;
    bytes32 constant T = keccak256("tournament-1");
    address constant OPERATOR = address(0x1001);
    address constant ALICE = address(0x2001);
    address constant BOB = address(0x2002);
    address constant CAROL = address(0x2003);
    address constant DAVE = address(0x2004);
    address constant EVE = address(0x2005);
    bytes32[5] ids = [keccak256("a"), keccak256("b"), keccak256("c"), keccak256("d"), keccak256("e")];

    function setUp() public {
        token = new MockUSDC();
        escrow = new TournamentEscrow(address(token));
        address[5] memory wallets = [ALICE, BOB, CAROL, DAVE, EVE];
        for (uint256 i; i < wallets.length; ++i) {
            token.mint(wallets[i], 1_000_000);
            vm.prank(wallets[i]);
            token.approve(address(escrow), type(uint256).max);
        }
        TournamentEscrow.Policy memory p;
        p.registrationOpensAt = 100;
        p.registrationClosesAt = 200;
        p.startsAt = 200;
        p.expiresAt = 500;
        p.minEntrants = 5;
        p.maxEntrants = 10;
        p.stakeAmount = 100_000;
        p.operatorAddress = OPERATOR;
        p.feeRecipient = address(this);
        p.payoutBps = [uint16(4000), uint16(2500), uint16(1500), uint16(1000), uint16(1000)];
        // Policy validation intentionally requires the product's 8-player minimum.
        p.minEntrants = 8;
        vm.prank(OPERATOR);
        escrow.createTournament(T, p);
    }

    function _register(bytes32 id, address wallet) internal {
        vm.prank(wallet);
        escrow.register(
            T, id, keccak256(abi.encode(id, "agent")), keccak256("v1"), keccak256(abi.encode(id, "commitment"))
        );
    }

    function _registerEight() internal {
        address[8] memory wallets = [ALICE, BOB, CAROL, DAVE, EVE, address(0x2006), address(0x2007), address(0x2008)];
        for (uint256 i; i < 3; ++i) {
            token.mint(wallets[i + 5], 1_000_000);
            vm.prank(wallets[i + 5]);
            token.approve(address(escrow), type(uint256).max);
        }
        vm.warp(100);
        for (uint256 i; i < wallets.length; ++i) {
            _register(bytes32(uint256(i + 1)), wallets[i]);
        }
    }

    function testRegistrationBoundaryAndDuplicate() public {
        vm.expectRevert(TournamentEscrow.TooEarly.selector);
        vm.prank(ALICE);
        escrow.register(T, bytes32(uint256(1)), bytes32(uint256(1)), bytes32(uint256(1)), bytes32(uint256(1)));
        vm.warp(100);
        _register(bytes32(uint256(1)), ALICE);
        vm.expectRevert(TournamentEscrow.Duplicate.selector);
        _register(bytes32(uint256(2)), ALICE);
        vm.warp(200);
        vm.expectRevert(TournamentEscrow.TooLate.selector);
        _register(bytes32(uint256(3)), BOB);
    }

    function testTokenTransferFailureLeavesAccountingUnchanged() public {
        vm.warp(100);
        token.setFailTransfers(true);
        vm.expectRevert(TournamentEscrow.TransferFailed.selector);
        _register(bytes32(uint256(1)), ALICE);
        TournamentEscrow.Tournament memory t = escrow.getTournament(T);
        assertEq(t.entrantCount, 0);
        assertEq(t.totalLockedStakes, 0);
    }

    function testInvalidPolicyAndTournamentIdRejected() public {
        TournamentEscrow.Policy memory p;
        p.registrationOpensAt = 100;
        p.registrationClosesAt = 100;
        p.startsAt = 100;
        p.expiresAt = 200;
        p.minEntrants = 8;
        p.maxEntrants = 8;
        p.stakeAmount = 1;
        p.operatorAddress = OPERATOR;
        p.feeRecipient = address(this);
        p.payoutBps = [uint16(4000), uint16(2500), uint16(1500), uint16(1000), uint16(1000)];
        vm.expectRevert(TournamentEscrow.InvalidPolicy.selector);
        escrow.createTournament(bytes32(uint256(99)), p);
        p.registrationClosesAt = 150;
        p.startsAt = 150;
        p.expiresAt = 200;
        p.feeRecipient = address(0x1002);
        vm.expectRevert(TournamentEscrow.InvalidPolicy.selector);
        escrow.createTournament(bytes32(uint256(98)), p);
        vm.expectRevert(TournamentEscrow.Duplicate.selector);
        vm.prank(OPERATOR);
        escrow.createTournament(T, p);
    }

    function testOnlyOperatorSettlementAndDerivedCredits() public {
        assertEq(escrow.owner(), address(this));
        assertEq(uint256(keccak256(bytes(escrow.VERSION()))), uint256(keccak256(bytes("TournamentEscrowV2"))));
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(201);
        escrow.markRunning(T);
        bytes32[] memory ranking = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            ranking[i] = bytes32(uint256(i + 1));
        }
        vm.expectRevert(TournamentEscrow.Unauthorized.selector);
        vm.prank(ALICE);
        escrow.settleByOperator(T, ranking, keccak256("rank"), 1);
        vm.prank(OPERATOR);
        escrow.settleByOperator(T, ranking, keccak256("rank"), 1);
        TournamentEscrow.Tournament memory t = escrow.getTournament(T);
        assertEq(uint256(t.state), uint256(TournamentEscrow.State.SETTLED));
        assertEq(t.platformFeeCredit, 80_000); // 8 * 100,000 * 10%
        assertEq(escrow.creditOf(T, ALICE), 288_000); // 720,000 net * 40%
        assertEq(escrow.creditOf(T, EVE), 72_000); // 720,000 net * 10%
        vm.expectRevert(TournamentEscrow.InvalidState.selector);
        vm.prank(OPERATOR);
        escrow.settleByOperator(T, ranking, keccak256("rank-2"), 2);
    }

    function testTrustedOperatorCanSettleAnyValidRegisteredRanking() public {
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(201);
        escrow.markRunning(T);
        bytes32[] memory operatorChosenRanking = new bytes32[](5);
        operatorChosenRanking[0] = bytes32(uint256(5));
        operatorChosenRanking[1] = bytes32(uint256(4));
        operatorChosenRanking[2] = bytes32(uint256(3));
        operatorChosenRanking[3] = bytes32(uint256(2));
        operatorChosenRanking[4] = bytes32(uint256(1));

        vm.prank(OPERATOR);
        escrow.settleByOperator(T, operatorChosenRanking, keccak256("operator-selected-ranking"), 1);

        assertEq(escrow.creditOf(T, EVE), 288_000);
        assertEq(escrow.creditOf(T, ALICE), 72_000);
        assertEq(uint256(escrow.getTournament(T).state), uint256(TournamentEscrow.State.SETTLED));
    }

    function testRankingDuplicateAndNonceRejectedWithoutMutation() public {
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(201);
        escrow.markRunning(T);
        bytes32[] memory ranking = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            ranking[i] = bytes32(uint256(i + 1));
        }
        ranking[4] = ranking[3];
        vm.expectRevert(TournamentEscrow.InvalidRanking.selector);
        vm.prank(OPERATOR);
        escrow.settleByOperator(T, ranking, keccak256("rank"), 1);
        assertEq(uint256(escrow.getTournament(T).state), uint256(TournamentEscrow.State.RUNNING));
    }

    function testWithdrawalAndZeroLiabilityClosure() public {
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(201);
        escrow.markRunning(T);
        bytes32[] memory ranking = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            ranking[i] = bytes32(uint256(i + 1));
        }
        vm.prank(OPERATOR);
        escrow.settleByOperator(T, ranking, keccak256("rank"), 1);
        vm.prank(ALICE);
        escrow.withdrawCredit(T);
        vm.prank(BOB);
        escrow.withdrawCredit(T);
        vm.prank(CAROL);
        escrow.withdrawCredit(T);
        vm.prank(DAVE);
        escrow.withdrawCredit(T);
        vm.prank(EVE);
        escrow.withdrawCredit(T);
        vm.prank(address(this));
        escrow.withdrawPlatformFee(T);
        escrow.closeTournament(T);
        assertEq(uint256(escrow.getTournament(T).state), uint256(TournamentEscrow.State.CLOSED));
    }

    function testRelayerCanWithdrawWinnerCreditOnlyToBeneficiary() public {
        _settleDefaultRanking();
        address relayer = address(0x9001);
        uint256 beneficiaryBalanceBefore = token.balanceOf(ALICE);

        vm.prank(relayer);
        escrow.withdrawCreditFor(T, ALICE);

        assertEq(token.balanceOf(ALICE), beneficiaryBalanceBefore + 288_000);
        assertEq(token.balanceOf(relayer), 0);
        assertEq(escrow.creditOf(T, ALICE), 0);
        assertEq(escrow.getTournament(T).totalLiability, 512_000);

        vm.expectRevert(TournamentEscrow.NoCredit.selector);
        vm.prank(relayer);
        escrow.withdrawCreditFor(T, ALICE);
    }

    function testRelayedWinnerTransferFailurePreservesCreditAndLiability() public {
        _settleDefaultRanking();
        token.setFailTransfers(true);

        vm.expectRevert(TournamentEscrow.TransferFailed.selector);
        vm.prank(address(0x9001));
        escrow.withdrawCreditFor(T, ALICE);

        assertEq(escrow.creditOf(T, ALICE), 288_000);
        assertEq(escrow.getTournament(T).totalLiability, 800_000);
    }

    function testRelayerCanSendPlatformFeeOnlyToLockedOwner() public {
        _settleDefaultRanking();
        address relayer = address(0x9001);

        vm.prank(relayer);
        escrow.withdrawPlatformFeeFor(T);

        assertEq(token.balanceOf(address(this)), 80_000);
        assertEq(token.balanceOf(relayer), 0);
        assertEq(escrow.getTournament(T).platformFeeCredit, 0);
        assertEq(escrow.getTournament(T).totalLiability, 720_000);

        vm.expectRevert(TournamentEscrow.NoCredit.selector);
        vm.prank(relayer);
        escrow.withdrawPlatformFeeFor(T);
    }

    function testRelayedPlatformFeeFailurePreservesCreditAndLiability() public {
        _settleDefaultRanking();
        token.setFailTransfers(true);

        vm.expectRevert(TournamentEscrow.TransferFailed.selector);
        vm.prank(address(0x9001));
        escrow.withdrawPlatformFeeFor(T);

        assertEq(escrow.getTournament(T).platformFeeCredit, 80_000);
        assertEq(escrow.getTournament(T).totalLiability, 800_000);
    }

    function testCancellationKeepsUnclaimedRefundLiability() public {
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(500);
        vm.prank(OPERATOR);
        escrow.cancelAndOpenRefunds(T, keccak256("insufficient"));
        assertEq(escrow.getTournament(T).totalLiability, 800_000);
        vm.expectRevert(TournamentEscrow.LiabilityOutstanding.selector);
        escrow.closeTournament(T);
        vm.prank(ALICE);
        escrow.claimRefund(T, bytes32(uint256(1)));
        vm.prank(ALICE);
        escrow.withdrawCredit(T);
        assertEq(escrow.getTournament(T).totalLiability, 700_000);
    }

    function testInsufficientEntrantsRefundAllAndCloseWithZeroFee() public {
        vm.warp(100);
        _register(bytes32(uint256(1)), ALICE);
        _register(bytes32(uint256(2)), BOB);
        _register(bytes32(uint256(3)), CAROL);
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.expectRevert(TournamentEscrow.InsufficientEntrants.selector);
        escrow.markRunning(T);
        vm.prank(OPERATOR);
        escrow.cancelAndOpenRefunds(T, keccak256("insufficient entrants"));
        assertEq(escrow.getTournament(T).platformFeeCredit, 0);

        address[3] memory wallets = [ALICE, BOB, CAROL];
        for (uint256 i; i < wallets.length; ++i) {
            vm.prank(wallets[i]);
            escrow.claimRefund(T, bytes32(uint256(i + 1)));
            vm.prank(wallets[i]);
            escrow.withdrawCredit(T);
            assertEq(token.balanceOf(wallets[i]), 1_000_000);
        }
        assertEq(escrow.getTournament(T).totalLiability, 0);
        escrow.closeTournament(T);
        assertEq(uint256(escrow.getTournament(T).state), uint256(TournamentEscrow.State.CLOSED));
    }

    function testTransitionTimeBoundariesWithStaleDraftPhase() public {
        vm.warp(199);
        vm.expectRevert(TournamentEscrow.TooEarly.selector);
        escrow.closeRegistration(T);
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.expectRevert(TournamentEscrow.InsufficientEntrants.selector);
        escrow.markRunning(T);
    }

    function _settleDefaultRanking() internal {
        _registerEight();
        vm.warp(200);
        escrow.closeRegistration(T);
        vm.warp(201);
        escrow.markRunning(T);
        bytes32[] memory ranking = new bytes32[](5);
        for (uint256 i; i < 5; ++i) ranking[i] = bytes32(uint256(i + 1));
        vm.prank(OPERATOR);
        escrow.settleByOperator(T, ranking, keccak256("rank"), 1);
    }
}
