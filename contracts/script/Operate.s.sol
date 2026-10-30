// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {BellguardHook} from "../src/BellguardHook.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

/// @notice Publish closed windows from research/gapscan (`python -m gapscan windows --json`).
///
/// Env: CALENDAR, WINDOWS_JSON (path to the JSON file). Windows that start too soon
/// (inside the notice period) or before the last published window are skipped.
///   forge script script/Operate.s.sol:PublishCalendar --rpc-url $RPC --account deployer --broadcast
contract PublishCalendar is Script {
    struct Row {
        uint256 end;
        string label;
        uint256 start;
    }

    function run() external {
        MarketCalendar cal = MarketCalendar(vm.envAddress("CALENDAR"));
        Row[] memory rows = abi.decode(vm.parseJson(vm.readFile(vm.envString("WINDOWS_JSON"))), (Row[]));

        uint256 earliest = block.timestamp + cal.minNotice();
        uint256 n = cal.closureCount();
        uint256 lastEnd = n == 0 ? 0 : cal.closure(n - 1).end;

        uint256 count;
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](rows.length);
        for (uint256 i; i < rows.length; ++i) {
            if (rows[i].start < earliest || rows[i].start < lastEnd) continue;
            ws[count++] = MarketCalendar.Window(uint64(rows[i].start), uint64(rows[i].end));
            lastEnd = rows[i].end;
        }
        assembly {
            mstore(ws, count)
        }
        console2.log("Publishing closures:", count);
        if (count == 0) return;
        vm.startBroadcast();
        cal.addClosures(ws);
        vm.stopBroadcast();
    }
}

/// @notice Register a stock token and its Chainlink feed on the hook (owner only).
/// Env: HOOK, STOCK, FEED
contract RegisterStock is Script {
    function run() external {
        BellguardHook hook = BellguardHook(vm.envAddress("HOOK"));
        address stock = vm.envAddress("STOCK");
        address feed = vm.envAddress("FEED");
        console2.log("Feed:", IAggregatorV3(feed).description());
        vm.startBroadcast();
        hook.registerStock(stock, feed);
        vm.stopBroadcast();
    }
}

/// @notice Create a Bellguard stock/USDG pool, initialised at the Chainlink price.
/// Env: HOOK, STOCK, FEE [3000], TICK_SPACING [60]
contract CreatePool is Script {
    function run() external returns (PoolKey memory key) {
        BellguardHook hook = BellguardHook(vm.envAddress("HOOK"));
        address stock = vm.envAddress("STOCK");
        address usdg = Currency.unwrap(hook.quote());
        IPoolManager manager = hook.poolManager();

        bool stockIs0 = stock < usdg;
        key = PoolKey({
            currency0: Currency.wrap(stockIs0 ? stock : usdg),
            currency1: Currency.wrap(stockIs0 ? usdg : stock),
            fee: uint24(vm.envOr("FEE", uint256(3000))),
            tickSpacing: int24(int256(vm.envOr("TICK_SPACING", uint256(60)))),
            hooks: IHooks(address(hook))
        });

        uint160 sqrtPriceX96 = PriceMath.sqrtPriceFromFeed(IAggregatorV3(hook.stockFeed(stock)), stock, usdg, stockIs0);
        vm.startBroadcast();
        manager.initialize(key, sqrtPriceX96);
        vm.stopBroadcast();
        console2.log("Pool initialised. sqrtPriceX96:", sqrtPriceX96);
    }
}

library PriceMath {
    /// @dev sqrt(token1/token0 raw price) * 2^96 from a Chainlink USD price.
    function sqrtPriceFromFeed(IAggregatorV3 feed, address stock, address usdg, bool stockIs0)
        internal
        view
        returns (uint160)
    {
        (, int256 answer,,,) = feed.latestRoundData();
        require(answer > 0, "bad price");
        // quote raw per stock raw = answer * 10^quoteDec / 10^(feedDec + stockDec)
        uint256 num = uint256(answer) * 10 ** IERC20Metadata(usdg).decimals();
        uint256 den = 10 ** (uint256(feed.decimals()) + IERC20Metadata(stock).decimals());
        uint256 ratioX192 = stockIs0 ? Math.mulDiv(num, 1 << 192, den) : Math.mulDiv(den, 1 << 192, num);
        return uint160(Math.sqrt(ratioX192));
    }
}
