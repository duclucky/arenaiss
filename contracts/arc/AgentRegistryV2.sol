// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @notice Arc ownership registry for immutable Agent versions sold by the Arena marketplace.
contract AgentRegistryV2 {
    error InvalidAddress(); error InvalidAgentIdentity(); error AgentAlreadyExists(); error AgentNotFound();
    error AgentAlreadyInactive(); error UnauthorizedAgentOwner(); error UnauthorizedMarketplace(); error MarketplaceAlreadyConfigured(); error VersionMismatch();
    struct AgentRecord { address owner; bytes32 version; bytes32 commitment; bool active; }
    address public immutable administrator; address public marketplace;
    mapping(bytes32 => AgentRecord) public agents;
    event MarketplaceConfigured(address indexed marketplace); event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 indexed version, bytes32 commitment);
    event AgentTransferred(bytes32 indexed agentId, address indexed previousOwner, address indexed newOwner, bytes32 version, bytes32 commitment); event AgentDeactivated(bytes32 indexed agentId, address indexed owner);
    constructor(address administrator_) { if (administrator_ == address(0)) revert InvalidAddress(); administrator = administrator_; }
    function configureMarketplace(address marketplace_) external { if (msg.sender != administrator) revert UnauthorizedMarketplace(); if (marketplace != address(0)) revert MarketplaceAlreadyConfigured(); if (marketplace_ == address(0)) revert InvalidAddress(); marketplace = marketplace_; emit MarketplaceConfigured(marketplace_); }
    function registerAgent(bytes32 agentId, bytes32 version, bytes32 commitment) external { if (agentId == bytes32(0) || version == bytes32(0) || commitment == bytes32(0)) revert InvalidAgentIdentity(); if (agents[agentId].owner != address(0)) revert AgentAlreadyExists(); agents[agentId] = AgentRecord(msg.sender, version, commitment, true); emit AgentRegistered(agentId, msg.sender, version, commitment); }
    function deactivateAgent(bytes32 agentId) external { AgentRecord storage agent = agents[agentId]; if (agent.owner == address(0)) revert AgentNotFound(); if (agent.owner != msg.sender) revert UnauthorizedAgentOwner(); if (!agent.active) revert AgentAlreadyInactive(); agent.active = false; emit AgentDeactivated(agentId, msg.sender); }
    function transferAgent(bytes32 agentId, bytes32 version, bytes32 commitment, address from, address to) external {
        if (msg.sender != marketplace) revert UnauthorizedMarketplace(); if (to == address(0)) revert InvalidAddress(); AgentRecord storage agent = agents[agentId];
        if (!agent.active || agent.owner != from) revert UnauthorizedAgentOwner(); if (agent.version != version || agent.commitment != commitment) revert VersionMismatch();
        agent.owner = to; emit AgentTransferred(agentId, from, to, version, commitment);
    }
}
