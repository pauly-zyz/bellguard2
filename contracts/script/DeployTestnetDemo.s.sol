// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {MarketCalendar} from "../src/MarketCalendar.sol";
import {DeployBase} from "./Deploy.s.sol";
import {PriceMath} from "./Operate.s.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

/// @notice Owner-settable price feed for testnet demos only.
contract DemoFeed is IAggregatorV3 {
    address public immutable owner;
    string public description;
    int256 public answer;
    uint256 public updatedAt;

    constructor(string memory description_, int256 answer_) {
        owner = msg.sender;
        description = description_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function set(int256 answer_) external {
        require(msg.sender == owner, "owner");
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @notice Full demo on Robinhood Chain testnet (46630) with mock USDG, a mock stock
///         token and a settable feed, plus v4 test routers for swaps and liquidity.
///         Never use on mainnet.
///
/// Env: WINDOWS_JSON (from `python -m gapscan windows --json`), optional DEMO_PRICE [250e8]
///   forge script script/DeployTestnetDemo.s.sol --rpc-url $TESTNET_RPC --account deployer --broadcast
contract DeployTestnetDemo is DeployBase {
    struct Row {
        uint256 end;
        string label;
        uint256 start;
    }

    function run() external {
        require(block.chainid == 46630 || block.chainid == 31337, "testnet only");
        vm.startBroadcast();
        (, address me,) = vm.readCallers();

        MockERC20 usdg = new MockERC20("Demo USDG", "dUSDG", 6);
        MockERC20 stock = new MockERC20("Demo Tesla Stock Token", "dTSLA", 18);
        DemoFeed feed = new DemoFeed("Robinhood dTSLA / USD", int256(vm.envOr("DEMO_PRICE", uint256(250e8))));

        Deployed memory d = deploy(address(usdg), address(0), me, me, me, CREATE2_DEPLOYER);
        d.hook.registerStock(address(stock), address(feed));
        _publish(d.calendar);

        IPoolManager manager = d.hook.poolManager();
        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);

        bool stockIs0 = address(stock) < address(usdg);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(stockIs0 ? address(stock) : address(usdg)),
            currency1: Currency.wrap(stockIs0 ? address(usdg) : address(stock)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(d.hook))
        });
        uint160 sqrtP = PriceMath.sqrtPriceFromFeed(feed, address(stock), address(usdg), stockIs0);
        manager.initialize(key, sqrtP);

        // Seed ~$1M of liquidity per side and give the deployer demo balances.
        usdg.mint(me, 10_000_000e6);
        stock.mint(me, 100_000e18);
        usdg.approve(address(lpRouter), type(uint256).max);
        stock.approve(address(lpRouter), type(uint256).max);
        usdg.approve(address(swapRouter), type(uint256).max);
        stock.approve(address(swapRouter), type(uint256).max);
        usdg.approve(address(d.vault), type(uint256).max);
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtP) / 60 * 60;
        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tick - 6000,
                tickUpper: tick + 6000,
                liquidityDelta: 4e17,
                salt: bytes32(0)
            }),
            ""
        );
        d.vault.deposit(1_000_000e6, me);
        vm.stopBroadcast();

        string memory k = "demo";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "usdg", address(usdg));
        vm.serializeAddress(k, "stock", address(stock));
        vm.serializeAddress(k, "feed", address(feed));
        vm.serializeAddress(k, "poolManager", address(manager));
        vm.serializeAddress(k, "calendar", address(d.calendar));
        vm.serializeAddress(k, "vault", address(d.vault));
        vm.serializeAddress(k, "hook", address(d.hook));
        vm.serializeAddress(k, "claims", address(d.claims));
        vm.serializeAddress(k, "swapRouter", address(swapRouter));
        string memory json = vm.serializeAddress(k, "lpRouter", address(lpRouter));
        vm.writeJson(json, string.concat("deployments/demo-", vm.toString(block.chainid), ".json"));
        console2.log("Demo deployed. Addresses in deployments/demo-<chainId>.json");
    }

    function _publish(MarketCalendar cal) internal {
        string memory path = vm.envOr("WINDOWS_JSON", string(""));
        if (bytes(path).length == 0) return;
        Row[] memory rows = abi.decode(vm.parseJson(vm.readFile(path)), (Row[]));
        uint256 earliest = block.timestamp + cal.minNotice();
        uint256 count;
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](rows.length);
        for (uint256 i; i < rows.length; ++i) {
            if (rows[i].start < earliest) continue;
            ws[count++] = MarketCalendar.Window(uint64(rows[i].start), uint64(rows[i].end));
        }
        assembly {
            mstore(ws, count)
        }
        if (count > 0) cal.addClosures(ws);
    }
}
