// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AgentRegistry.sol";
import "./TestBase.sol";

contract AgentRegistryTest is TestBase {
    AgentRegistry registry;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    bytes32 constant AGENT = keccak256("agent");
    bytes32 constant VERSION = keccak256("version-1");
    bytes32 constant COMMITMENT = keccak256("agents-md");

    function setUp() public { registry = new AgentRegistry(); }

    function testOwnerRegistersAndDeactivatesAgent() public {
        vm.prank(ALICE);
        registry.registerAgent(AGENT, VERSION, COMMITMENT);
        (address owner, bytes32 version, bytes32 commitment, bool active) = registry.agents(AGENT);
        assertEq(owner, ALICE);
        require(version == VERSION && commitment == COMMITMENT && active, "stored agent");

        vm.prank(ALICE);
        registry.deactivateAgent(AGENT);
        (, , , active) = registry.agents(AGENT);
        require(!active, "deactivated");
    }

    function testDuplicateAndUnauthorizedMutationRevert() public {
        vm.prank(ALICE);
        registry.registerAgent(AGENT, VERSION, COMMITMENT);
        vm.prank(ALICE);
        vm.expectRevert(AgentRegistry.AgentAlreadyExists.selector);
        registry.registerAgent(AGENT, VERSION, COMMITMENT);
        vm.prank(BOB);
        vm.expectRevert(AgentRegistry.UnauthorizedAgentOwner.selector);
        registry.deactivateAgent(AGENT);
    }

    function testZeroIdentityFieldsRevert() public {
        vm.prank(ALICE);
        vm.expectRevert(AgentRegistry.InvalidAgentIdentity.selector);
        registry.registerAgent(bytes32(0), VERSION, COMMITMENT);
        vm.prank(ALICE);
        vm.expectRevert(AgentRegistry.InvalidAgentIdentity.selector);
        registry.registerAgent(AGENT, bytes32(0), COMMITMENT);
        vm.prank(ALICE);
        vm.expectRevert(AgentRegistry.InvalidAgentIdentity.selector);
        registry.registerAgent(AGENT, VERSION, bytes32(0));
    }
}
