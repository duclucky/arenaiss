// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IPairUsdc {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address account, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Two-player USDC escrow. The configured operator supplies a winner only
/// after checking a finalized GenLayer comparison; Arc does not verify that proof.
contract PairMatchEscrow {
    enum State {
        NONE,
        OPEN,
        JOINED,
        SETTLED,
        REFUNDABLE
    }

    struct Room {
        address creator;
        address challenger;
        bytes32 creatorAgentVersion;
        bytes32 challengerAgentVersion;
        uint128 stake;
        uint64 joinDeadline;
        uint64 resolutionDeadline;
        State state;
        address winner;
        bytes32 verdictDigest;
        bool creatorCancelRequested;
        bool challengerCancelRequested;
    }

    IPairUsdc public immutable usdc;
    address public immutable operator;
    uint256 public totalLiability;
    mapping(bytes32 => Room) private rooms;
    mapping(bytes32 => mapping(address => uint256)) public creditOf;
    bool private withdrawing;

    error InvalidRoom();
    error InvalidState();
    error Unauthorized();
    error Deadline();
    error Duplicate();
    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferFailed();
    error NoCredit();
    error Reentrant();

    event RoomCreated(
        bytes32 indexed roomId,
        address indexed creator,
        bytes32 agentVersion,
        uint256 stake,
        uint64 joinDeadline,
        uint64 resolutionDeadline
    );
    event RoomJoined(bytes32 indexed roomId, address indexed challenger, bytes32 agentVersion);
    event CancelRequested(bytes32 indexed roomId, address indexed player);
    event RefundsOpened(bytes32 indexed roomId);
    event RoomSettled(bytes32 indexed roomId, address indexed winner, bytes32 verdictDigest, uint256 payout);
    event CreditWithdrawn(bytes32 indexed roomId, address indexed player, uint256 amount);

    constructor(address usdcAddress, address operatorAddress) {
        if (usdcAddress == address(0) || operatorAddress == address(0)) revert InvalidRoom();
        usdc = IPairUsdc(usdcAddress);
        operator = operatorAddress;
    }

    function getRoom(bytes32 roomId) external view returns (Room memory) {
        return rooms[roomId];
    }

    /// @dev Approval is a separate wallet transaction; a failed deposit reverts room creation.
    function createRoom(
        bytes32 roomId,
        bytes32 agentVersion,
        uint128 stake,
        uint64 joinDeadline,
        uint64 resolutionDeadline
    ) external {
        if (
            roomId == bytes32(0) || agentVersion == bytes32(0) || stake == 0 || joinDeadline <= block.timestamp
                || resolutionDeadline <= joinDeadline || resolutionDeadline > block.timestamp + 30 days
        ) revert InvalidRoom();
        if (rooms[roomId].state != State.NONE) revert Duplicate();
        _deposit(msg.sender, stake);
        rooms[roomId] = Room(
            msg.sender,
            address(0),
            agentVersion,
            bytes32(0),
            stake,
            joinDeadline,
            resolutionDeadline,
            State.OPEN,
            address(0),
            bytes32(0),
            false,
            false
        );
        totalLiability += stake;
        emit RoomCreated(roomId, msg.sender, agentVersion, stake, joinDeadline, resolutionDeadline);
    }

    function joinRoom(bytes32 roomId, bytes32 agentVersion) external {
        Room storage room = rooms[roomId];
        if (room.state != State.OPEN) revert InvalidState();
        if (block.timestamp >= room.joinDeadline) revert Deadline();
        if (msg.sender == room.creator || agentVersion == bytes32(0) || agentVersion == room.creatorAgentVersion) {
            revert InvalidRoom();
        }
        _deposit(msg.sender, room.stake);
        room.challenger = msg.sender;
        room.challengerAgentVersion = agentVersion;
        room.state = State.JOINED;
        totalLiability += room.stake;
        emit RoomJoined(roomId, msg.sender, agentVersion);
    }

    /// @notice The creator cancels an unjoined room. Both players must agree to
    /// cancel a joined room; either may independently open refunds at the deadline.
    function cancelRoom(bytes32 roomId) external {
        Room storage room = rooms[roomId];
        if (room.state != State.OPEN || msg.sender != room.creator) revert Unauthorized();
        _openRefunds(roomId, room);
    }

    function requestCancel(bytes32 roomId) external {
        Room storage room = rooms[roomId];
        if (room.state != State.JOINED) revert InvalidState();
        if (msg.sender == room.creator) room.creatorCancelRequested = true;
        else if (msg.sender == room.challenger) room.challengerCancelRequested = true;
        else revert Unauthorized();
        emit CancelRequested(roomId, msg.sender);
        if (room.creatorCancelRequested && room.challengerCancelRequested) _openRefunds(roomId, room);
    }

    function expireRoom(bytes32 roomId) external {
        Room storage room = rooms[roomId];
        if (room.state == State.OPEN) {
            if (block.timestamp < room.joinDeadline) revert Deadline();
        } else if (room.state == State.JOINED) {
            if (block.timestamp < room.resolutionDeadline) revert Deadline();
        } else {
            revert InvalidState();
        }
        _openRefunds(roomId, room);
    }

    function settle(bytes32 roomId, address winner, bytes32 verdictDigest) external {
        if (msg.sender != operator) revert Unauthorized();
        Room storage room = rooms[roomId];
        if (room.state != State.JOINED) revert InvalidState();
        if (block.timestamp >= room.resolutionDeadline) revert Deadline();
        if (winner != room.creator && winner != room.challenger) revert InvalidRoom();
        if (verdictDigest == bytes32(0)) revert InvalidRoom();
        room.state = State.SETTLED;
        room.winner = winner;
        room.verdictDigest = verdictDigest;
        uint256 payout = uint256(room.stake) * 2;
        creditOf[roomId][winner] = payout;
        emit RoomSettled(roomId, winner, verdictDigest, payout);
    }

    function withdraw(bytes32 roomId) external {
        if (withdrawing) revert Reentrant();
        uint256 amount = creditOf[roomId][msg.sender];
        if (amount == 0) revert NoCredit();
        withdrawing = true;
        creditOf[roomId][msg.sender] = 0;
        totalLiability -= amount;
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
        withdrawing = false;
        emit CreditWithdrawn(roomId, msg.sender, amount);
    }

    function _openRefunds(bytes32 roomId, Room storage room) private {
        room.state = State.REFUNDABLE;
        creditOf[roomId][room.creator] = room.stake;
        if (room.challenger != address(0)) creditOf[roomId][room.challenger] = room.stake;
        emit RefundsOpened(roomId);
    }

    function _deposit(address payer, uint256 amount) private {
        if (usdc.balanceOf(payer) < amount) revert InsufficientBalance();
        if (usdc.allowance(payer, address(this)) < amount) revert InsufficientAllowance();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        if (!usdc.transferFrom(payer, address(this), amount)) revert TransferFailed();
        if (usdc.balanceOf(address(this)) != beforeBalance + amount) revert TransferFailed();
    }
}
