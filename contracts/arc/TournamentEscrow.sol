// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Local MVP escrow for the TRUSTED_OPERATOR tournament lifecycle.
/// @dev The operator supplies only a validated ranking. Arc derives every amount.
contract TournamentEscrow {
    string public constant VERSION = "TournamentEscrowV2";
    uint16 public constant PLATFORM_FEE_BPS = 1_000;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant RANK_COUNT = 5;

    enum State {
        DRAFT,
        REGISTRATION_CLOSED,
        RUNNING,
        SETTLED,
        CANCELLED_REFUNDABLE,
        CLOSED
    }

    struct Policy {
        uint64 registrationOpensAt;
        uint64 registrationClosesAt;
        uint64 startsAt;
        uint64 expiresAt;
        uint32 minEntrants;
        uint32 maxEntrants;
        uint128 stakeAmount;
        address operatorAddress;
        address feeRecipient;
        uint16[5] payoutBps;
    }

    struct Tournament {
        Policy policy;
        State state;
        uint32 entrantCount;
        uint256 totalLockedStakes;
        uint256 totalLiability;
        uint256 platformFeeCredit;
        bytes32 rankingDigest;
        uint256 settlementNonce;
    }

    struct Entrant {
        address wallet;
        bytes32 agentId;
        bytes32 agentsVersion;
        bytes32 agentsCommitment;
        bool registered;
        bool ranked;
    }

    IERC20Minimal public immutable usdc;
    address public immutable owner;
    mapping(bytes32 => bool) private created;
    mapping(bytes32 => Tournament) private tournaments;
    mapping(bytes32 => mapping(bytes32 => Entrant)) private entrants;
    mapping(bytes32 => mapping(address => bool)) private walletEntered;
    mapping(bytes32 => mapping(address => uint256)) private credits;
    mapping(bytes32 => mapping(address => bool)) private refunds;

    error InvalidPolicy();
    error InvalidState();
    error Unauthorized();
    error TooEarly();
    error TooLate();
    error Duplicate();
    error InvalidEntrant();
    error InvalidRanking();
    error InsufficientEntrants();
    error NotExpired();
    error NoCredit();
    error TransferFailed();
    error LiabilityOutstanding();

    event TournamentCreated(bytes32 indexed tournamentId, address indexed operatorAddress);
    event EntrantRegistered(
        bytes32 indexed tournamentId, bytes32 indexed entrantId, address indexed wallet, uint256 stakeAmount
    );
    event RegistrationClosed(bytes32 indexed tournamentId);
    event TournamentRunning(bytes32 indexed tournamentId);
    event SettlementAccepted(bytes32 indexed tournamentId, bytes32 rankingDigest, uint256 settlementNonce, uint256 fee);
    event RefundsOpened(bytes32 indexed tournamentId, bytes32 reason);
    event CreditWithdrawn(bytes32 indexed tournamentId, address indexed account, uint256 amount);
    event PlatformFeeWithdrawn(bytes32 indexed tournamentId, address indexed account, uint256 amount);
    event TournamentClosed(bytes32 indexed tournamentId);

    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) revert InvalidPolicy();
        usdc = IERC20Minimal(usdcAddress);
        owner = msg.sender;
    }

    function createTournament(bytes32 tournamentId, Policy calldata policy) external {
        if (tournamentId == bytes32(0) || created[tournamentId]) revert Duplicate();
        if (
            policy.operatorAddress == address(0) || policy.feeRecipient != owner
                || policy.registrationOpensAt >= policy.registrationClosesAt
                || policy.registrationClosesAt > policy.startsAt || policy.startsAt >= policy.expiresAt
                || policy.minEntrants < 8 || policy.maxEntrants > 32 || policy.minEntrants > policy.maxEntrants
                || policy.stakeAmount == 0
        ) revert InvalidPolicy();
        uint256 payoutSum;
        for (uint256 i; i < RANK_COUNT; ++i) {
            payoutSum += policy.payoutBps[i];
        }
        if (payoutSum != BPS_DENOMINATOR) revert InvalidPolicy();
        tournaments[tournamentId] = Tournament({
            policy: policy,
            state: State.DRAFT,
            entrantCount: 0,
            totalLockedStakes: 0,
            totalLiability: 0,
            platformFeeCredit: 0,
            rankingDigest: bytes32(0),
            settlementNonce: 0
        });
        created[tournamentId] = true;
        emit TournamentCreated(tournamentId, policy.operatorAddress);
    }

    function register(
        bytes32 tournamentId,
        bytes32 entrantId,
        bytes32 agentId,
        bytes32 agentsVersion,
        bytes32 agentsCommitment
    ) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.state != State.DRAFT) revert InvalidState();
        if (block.timestamp < t.policy.registrationOpensAt) revert TooEarly();
        if (block.timestamp >= t.policy.registrationClosesAt) revert TooLate();
        if (t.entrantCount >= t.policy.maxEntrants) revert InvalidState();
        if (
            entrantId == bytes32(0) || agentId == bytes32(0) || agentsVersion == bytes32(0)
                || agentsCommitment == bytes32(0)
        ) revert InvalidEntrant();
        if (entrants[tournamentId][entrantId].registered || walletEntered[tournamentId][msg.sender]) {
            revert Duplicate();
        }
        uint256 amount = t.policy.stakeAmount;
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        entrants[tournamentId][entrantId] = Entrant(msg.sender, agentId, agentsVersion, agentsCommitment, true, false);
        walletEntered[tournamentId][msg.sender] = true;
        t.entrantCount += 1;
        t.totalLockedStakes += amount;
        emit EntrantRegistered(tournamentId, entrantId, msg.sender, amount);
    }

    function closeRegistration(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.state != State.DRAFT) revert InvalidState();
        if (block.timestamp < t.policy.registrationClosesAt) revert TooEarly();
        t.state = State.REGISTRATION_CLOSED;
        emit RegistrationClosed(tournamentId);
    }

    function markRunning(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.state != State.REGISTRATION_CLOSED) revert InvalidState();
        if (block.timestamp < t.policy.startsAt) revert TooEarly();
        if (t.entrantCount < t.policy.minEntrants) revert InsufficientEntrants();
        t.state = State.RUNNING;
        emit TournamentRunning(tournamentId);
    }

    function cancelAndOpenRefunds(bytes32 tournamentId, bytes32 reason) external {
        Tournament storage t = tournaments[tournamentId];
        if (msg.sender != t.policy.operatorAddress) revert Unauthorized();
        if (t.state != State.DRAFT && t.state != State.REGISTRATION_CLOSED && t.state != State.RUNNING) {
            revert InvalidState();
        }
        bool insufficientAfterClose =
            t.entrantCount < t.policy.minEntrants && block.timestamp >= t.policy.registrationClosesAt;
        if (!insufficientAfterClose && block.timestamp < t.policy.expiresAt) revert NotExpired();
        t.state = State.CANCELLED_REFUNDABLE;
        t.totalLiability = t.totalLockedStakes;
        t.totalLockedStakes = 0;
        emit RefundsOpened(tournamentId, reason);
    }

    /// @dev Opens one refund credit after cancellation. Only the registered wallet can call it.
    ///      It is permissionless and idempotency-protected, so no roster loop or keeper is needed.
    function claimRefund(bytes32 tournamentId, bytes32 entrantId) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.state != State.CANCELLED_REFUNDABLE) revert InvalidState();
        Entrant storage e = entrants[tournamentId][entrantId];
        if (!e.registered || e.wallet != msg.sender || refunds[tournamentId][msg.sender]) revert InvalidEntrant();
        refunds[tournamentId][msg.sender] = true;
        uint256 amount = t.policy.stakeAmount;
        credits[tournamentId][msg.sender] += amount;
        // The cancelled locked-stake liability was accounted for atomically when
        // cancellation opened. Claiming only assigns that existing liability.
    }

    function settleByOperator(
        bytes32 tournamentId,
        bytes32[] calldata rankedEntrants,
        bytes32 rankingDigest,
        uint256 settlementNonce
    ) external {
        Tournament storage t = tournaments[tournamentId];
        if (msg.sender != t.policy.operatorAddress) revert Unauthorized();
        if (t.state != State.RUNNING) revert InvalidState();
        if (rankedEntrants.length != RANK_COUNT || rankingDigest == bytes32(0) || settlementNonce == 0) {
            revert InvalidRanking();
        }
        if (settlementNonce <= t.settlementNonce) revert Duplicate();
        uint256 grossPool = t.totalLockedStakes;
        uint256 fee = grossPool * PLATFORM_FEE_BPS / BPS_DENOMINATOR;
        uint256 net = grossPool - fee;
        uint256 distributed;
        for (uint256 i; i < RANK_COUNT; ++i) {
            bytes32 entrantId = rankedEntrants[i];
            Entrant storage e = entrants[tournamentId][entrantId];
            if (!e.registered || e.ranked) revert InvalidRanking();
            e.ranked = true;
            for (uint256 j; j < i; ++j) {
                if (rankedEntrants[j] == entrantId) revert InvalidRanking();
            }
            uint256 amount = net * t.policy.payoutBps[i] / BPS_DENOMINATOR;
            credits[tournamentId][e.wallet] += amount;
            distributed += amount;
        }
        uint256 remainder = net - distributed;
        if (remainder > 0) credits[tournamentId][entrants[tournamentId][rankedEntrants[0]].wallet] += remainder;
        t.platformFeeCredit = fee;
        t.totalLiability = grossPool;
        t.totalLockedStakes = 0;
        t.rankingDigest = rankingDigest;
        t.settlementNonce = settlementNonce;
        t.state = State.SETTLED;
        emit SettlementAccepted(tournamentId, rankingDigest, settlementNonce, fee);
    }

    function withdrawCredit(bytes32 tournamentId) external {
        _withdrawCredit(tournamentId, msg.sender);
    }

    /// @notice Lets any keeper pay gas to deliver an existing credit.
    /// @dev The beneficiary is both the credit owner and the fixed transfer destination;
    ///      the caller cannot redirect another account's USDC.
    function withdrawCreditFor(bytes32 tournamentId, address beneficiary) external {
        _withdrawCredit(tournamentId, beneficiary);
    }

    function _withdrawCredit(bytes32 tournamentId, address beneficiary) internal {
        uint256 amount = credits[tournamentId][beneficiary];
        if (amount == 0) revert NoCredit();
        credits[tournamentId][beneficiary] = 0;
        tournaments[tournamentId].totalLiability -= amount;
        if (!usdc.transfer(beneficiary, amount)) revert TransferFailed();
        emit CreditWithdrawn(tournamentId, beneficiary, amount);
    }

    function withdrawPlatformFee(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        if (msg.sender != t.policy.feeRecipient) revert Unauthorized();
        _withdrawPlatformFee(tournamentId, t);
    }

    /// @notice Lets any keeper pay gas to deliver the platform fee to its locked recipient.
    function withdrawPlatformFeeFor(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        _withdrawPlatformFee(tournamentId, t);
    }

    function _withdrawPlatformFee(bytes32 tournamentId, Tournament storage t) internal {
        uint256 amount = t.platformFeeCredit;
        if (amount == 0) revert NoCredit();
        t.platformFeeCredit = 0;
        t.totalLiability -= amount;
        address feeRecipient = t.policy.feeRecipient;
        if (!usdc.transfer(feeRecipient, amount)) revert TransferFailed();
        emit PlatformFeeWithdrawn(tournamentId, feeRecipient, amount);
    }

    function closeTournament(bytes32 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.state != State.SETTLED && t.state != State.CANCELLED_REFUNDABLE) revert InvalidState();
        if (t.totalLiability != 0 || t.totalLockedStakes != 0) revert LiabilityOutstanding();
        t.state = State.CLOSED;
        emit TournamentClosed(tournamentId);
    }

    function getTournament(bytes32 tournamentId) external view returns (Tournament memory) {
        return tournaments[tournamentId];
    }

    function getEntrant(bytes32 tournamentId, bytes32 entrantId) external view returns (Entrant memory) {
        return entrants[tournamentId][entrantId];
    }

    function creditOf(bytes32 tournamentId, address account) external view returns (uint256) {
        return credits[tournamentId][account];
    }
}
