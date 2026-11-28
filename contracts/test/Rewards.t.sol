// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RewardsDistributor} from "../src/rewards/RewardsDistributor.sol";
import {TestUSD} from "../src/perps/TestUSD.sol";

contract RewardsTest is Test {
    TestUSD usd;
    RewardsDistributor dist;
    address owner = address(0xA11CE);
    address alice = address(0xA);
    address bob = address(0xB);

    function leaf(address a, uint256 c) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, c))));
    }

    /// two-leaf tree: root = hash of the sorted pair; each proof is the other leaf
    function root2(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encodePacked(x, y)) : keccak256(abi.encodePacked(y, x));
    }

    function setUp() public {
        usd = new TestUSD(address(this));
        dist = new RewardsDistributor(IERC20(address(usd)), owner);
        usd.mint(address(dist), 1_000e6);
    }

    function test_claimAcrossWeeks() public {
        bytes32 la = leaf(alice, 100e6);
        bytes32 lb = leaf(bob, 50e6);
        vm.prank(owner);
        dist.publish(1, root2(la, lb));
        bytes32[] memory p = new bytes32[](1);
        p[0] = lb;
        dist.claim(alice, 100e6, p);
        assertEq(usd.balanceOf(alice), 100e6);
        vm.expectRevert(RewardsDistributor.NothingToClaim.selector);
        dist.claim(alice, 100e6, p);

        // week 2: alice cumulative 130 (earned 30 more), bob 50 unclaimed from week 1 + 20
        bytes32 la2 = leaf(alice, 130e6);
        bytes32 lb2 = leaf(bob, 70e6);
        vm.prank(owner);
        dist.publish(2, root2(la2, lb2));
        p[0] = lb2;
        dist.claim(alice, 130e6, p);
        assertEq(usd.balanceOf(alice), 130e6, "only the new 30 paid");
        p[0] = la2;
        dist.claim(bob, 70e6, p);
        assertEq(usd.balanceOf(bob), 70e6, "both weeks in one claim");
    }

    function test_badProofAndWrongAmount() public {
        bytes32 la = leaf(alice, 100e6);
        bytes32 lb = leaf(bob, 50e6);
        vm.prank(owner);
        dist.publish(1, root2(la, lb));
        bytes32[] memory p = new bytes32[](1);
        p[0] = lb;
        vm.expectRevert(RewardsDistributor.InvalidProof.selector);
        dist.claim(alice, 200e6, p);
        vm.expectRevert(RewardsDistributor.InvalidProof.selector);
        dist.claim(bob, 50e6, p);
    }

    function test_onlyOwnerPublishesForward() public {
        vm.expectRevert();
        dist.publish(1, bytes32(uint256(1)));
        vm.startPrank(owner);
        dist.publish(1, bytes32(uint256(1)));
        vm.expectRevert(RewardsDistributor.StaleEpoch.selector);
        dist.publish(1, bytes32(uint256(2)));
        dist.sweep(owner, 10e6);
        vm.stopPrank();
        assertEq(usd.balanceOf(owner), 10e6);
    }
}
