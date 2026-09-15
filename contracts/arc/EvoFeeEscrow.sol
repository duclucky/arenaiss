// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IEvoFeeToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract EvoFeeEscrow {
    error InvalidAddress();
    error InvalidConfiguration();
    error InvalidCampaign();
    error UnauthorizedOperator();
    error UnauthorizedPayer();
    error PaymentUnavailable();
    error RefundTooEarly();
    error TokenTransferFailed();
    error Reentrancy();

    enum PaymentState { NONE, HELD, RELEASED, REFUNDED }
    struct Payment { address payer; uint64 depositedAt; PaymentState state; }

    IEvoFeeToken public immutable usdc;
    address public immutable operator;
    address public immutable feeRecipient;
    uint256 public immutable fixedFee;
    uint64 public immutable refundDelay;
    uint256 private entered;
    mapping(bytes32 => Payment) public payments;

    event FeeDeposited(bytes32 indexed campaignId, address indexed payer, uint256 amount, uint64 refundAvailableAt);
    event FeeReleased(bytes32 indexed campaignId, address indexed recipient, uint256 amount);
    event FeeRefunded(bytes32 indexed campaignId, address indexed payer, uint256 amount, bool timeoutClaim);

    modifier onlyOperator() { if (msg.sender != operator) revert UnauthorizedOperator(); _; }
    modifier nonReentrant() { if (entered != 0) revert Reentrancy(); entered = 1; _; entered = 0; }

    constructor(address usdc_, address operator_, address feeRecipient_, uint256 fixedFee_, uint64 refundDelay_) {
        if (usdc_ == address(0) || operator_ == address(0) || feeRecipient_ == address(0)) revert InvalidAddress();
        if (fixedFee_ == 0 || refundDelay_ == 0) revert InvalidConfiguration();
        usdc = IEvoFeeToken(usdc_);
        operator = operator_;
        feeRecipient = feeRecipient_;
        fixedFee = fixedFee_;
        refundDelay = refundDelay_;
    }

    function deposit(bytes32 campaignId) external nonReentrant {
        if (campaignId == bytes32(0)) revert InvalidCampaign();
        if (payments[campaignId].state != PaymentState.NONE) revert PaymentUnavailable();
        uint64 depositedAt = uint64(block.timestamp);
        payments[campaignId] = Payment(msg.sender, depositedAt, PaymentState.HELD);
        if (!usdc.transferFrom(msg.sender, address(this), fixedFee)) revert TokenTransferFailed();
        emit FeeDeposited(campaignId, msg.sender, fixedFee, depositedAt + refundDelay);
    }

    function release(bytes32 campaignId) external onlyOperator nonReentrant {
        Payment storage payment = _held(campaignId);
        payment.state = PaymentState.RELEASED;
        if (!usdc.transfer(feeRecipient, fixedFee)) revert TokenTransferFailed();
        emit FeeReleased(campaignId, feeRecipient, fixedFee);
    }

    function refund(bytes32 campaignId) external onlyOperator nonReentrant {
        Payment storage payment = _held(campaignId);
        address payer = payment.payer;
        payment.state = PaymentState.REFUNDED;
        if (!usdc.transfer(payer, fixedFee)) revert TokenTransferFailed();
        emit FeeRefunded(campaignId, payer, fixedFee, false);
    }

    function claimTimeoutRefund(bytes32 campaignId) external nonReentrant {
        Payment storage payment = _held(campaignId);
        if (msg.sender != payment.payer) revert UnauthorizedPayer();
        if (block.timestamp < uint256(payment.depositedAt) + refundDelay) revert RefundTooEarly();
        payment.state = PaymentState.REFUNDED;
        if (!usdc.transfer(msg.sender, fixedFee)) revert TokenTransferFailed();
        emit FeeRefunded(campaignId, msg.sender, fixedFee, true);
    }

    function _held(bytes32 campaignId) private view returns (Payment storage payment) {
        payment = payments[campaignId];
        if (payment.state != PaymentState.HELD) revert PaymentUnavailable();
    }
}
