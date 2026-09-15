// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @notice Public Arc registry for Agent identities and AGENTS.md commitments.
/// @dev Plaintext AGENTS.md never enters this contract. Deactivation is permanent
///      and preserves the immutable audit trail expected from an onchain registry.
contract AgentRegistry {
    error InvalidAgentIdentity();
    error AgentAlreadyExists();
    error AgentNotFound();
    error AgentAlreadyInactive();
    error UnauthorizedAgentOwner();

    struct AgentRecord {
        address owner;
        bytes32 version;
        bytes32 commitment;
        bool active;
    }

    mapping(bytes32 => AgentRecord) public agents;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 indexed version, bytes32 commitment);
    event AgentDeactivated(bytes32 indexed agentId, address indexed owner);

    function registerAgent(bytes32 agentId, bytes32 version, bytes32 commitment) external {
        if (agentId == bytes32(0) || version == bytes32(0) || commitment == bytes32(0)) revert InvalidAgentIdentity();
        if (agents[agentId].owner != address(0)) revert AgentAlreadyExists();
        agents[agentId] = AgentRecord(msg.sender, version, commitment, true);
        emit AgentRegistered(agentId, msg.sender, version, commitment);
    }

    function deactivateAgent(bytes32 agentId) external {
        AgentRecord storage agent = agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.owner != msg.sender) revert UnauthorizedAgentOwner();
        if (!agent.active) revert AgentAlreadyInactive();
        agent.active = false;
        emit AgentDeactivated(agentId, msg.sender);
    }
}
