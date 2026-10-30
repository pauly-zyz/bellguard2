// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

import {DeployBase} from "../script/Deploy.s.sol";
import {PublishCalendar, PriceMath} from "../script/Operate.s.sol";
import {DemoFeed} from "../script/DeployTestnetDemo.s.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";

contract DeployHarness is DeployBase {
    function deployHere(address usdg, address pm, address owner, address treasury)
        external
        returns (Deployed memory)
    {
        return deploy(usdg, pm, owner, treasury, address(this), address(this));
    }

    function sqrtPrice(DemoFeed feed, address stock, address usdg, bool stockIs0) external view returns (uint160) {
        return PriceMath.sqrtPriceFromFeed(feed, stock, usdg, stockIs0);
    }
}

contract DeployTest is Test, Deployers {
    using StateLibrary for *;
    using PoolIdLibrary for PoolKey;

    DeployHarness harness;
    MockERC20 usdg;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");

    function setUp() public {
        vm.warp(1_793_000_000);
        deployFreshManagerAndRouters();
        vm.setEnv("POOL_MANAGER", vm.toString(address(manager)));
        usdg = new MockERC20("USDG", "USDG", 6);
        harness = new DeployHarness();
    }

    function test_deployWiresEverything() public {
        DeployBase.Deployed memory d = harness.deployHere(address(usdg), address(0xBEEF), owner, treasury);

        // Hook address carries exactly the permission bits it implements
        assertEq(uint160(address(d.hook)) & Hooks.ALL_HOOK_MASK, uint160(0x2AC4));
        assertEq(address(d.hook.poolManager()), address(manager));
        assertEq(d.hook.vault(), address(d.vault));
        assertEq(d.hook.treasury(), treasury);
        assertEq(d.hook.owner(), owner);
        assertEq(d.hook.closedBps(), 10);

        assertEq(d.vault.claims(), address(d.claims));
        assertEq(d.vault.pendingOwner(), owner); // two-step handover
        assertEq(d.claims.owner(), owner);
        assertEq(d.claims.positionManager(), address(0xBEEF));
        assertEq(d.calendar.owner(), address(harness)); // kept for publishing windows
    }

    function test_publishCalendarFromGapscanJson() public {
        DeployBase.Deployed memory d = harness.deployHere(address(usdg), address(0xBEEF), owner, treasury);
        vm.prank(address(harness));
        d.calendar.transferOwnership(address(this));
        d.calendar.acceptOwnership();

        // The JSON committed next to the scripts covers Nov 2026 - Feb 2027
        vm.warp(1_793_000_000); // 2026-10-27
        vm.setEnv("CALENDAR", vm.toString(address(d.calendar)));
        vm.setEnv("WINDOWS_JSON", "script/windows-2026-11-to-2027-02.json");
        PublishCalendar pub = new PublishCalendar();
        // vm.startBroadcast() inside the script sends from forge's default sender
        d.calendar.transferOwnership(DEFAULT_SENDER);
        vm.prank(DEFAULT_SENDER);
        d.calendar.acceptOwnership();
        pub.run();

        uint256 n = d.calendar.closureCount();
        assertGt(n, 15);
        // First window: weekend starting Sat 2026-10-31 02:00 Berlin (01:00 UTC)
        assertEq(d.calendar.closure(0).start, 1_793_408_400);
        assertTrue(d.calendar.isClosed(1_793_408_400 + 1 days));
    }

    function test_sqrtPriceFromFeedMatchesTickMath() public {
        DemoFeed feed = new DemoFeed("Robinhood TEST / USD", 250e8);
        MockERC20 stock = new MockERC20("S", "S", 18);
        // stock as token0: raw price = 250e6 / 1e18
        uint160 a = harness.sqrtPrice(feed, address(stock), address(usdg), true);
        int24 tickA = TickMath.getTickAtSqrtPrice(a);
        assertApproxEqAbs(tickA, -221107, 2); // log_1.0001(2.5e-10)
        // stock as token1: inverse price
        uint160 b = harness.sqrtPrice(feed, address(stock), address(usdg), false);
        assertApproxEqAbs(TickMath.getTickAtSqrtPrice(b), 221107, 2);
    }
}
