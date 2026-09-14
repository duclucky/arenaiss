// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
}

contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "assert true");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assert uint");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "assert address");
    }
}
