// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarketCalendar} from "../src/MarketCalendar.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PerpVault} from "../src/perps/PerpVault.sol";
import {PerpEngine} from "../src/perps/PerpEngine.sol";
import {PushPriceFeed} from "../src/perps/PushPriceFeed.sol";
import {TestUSD} from "../src/perps/TestUSD.sol";

/// @notice Deploy Bellguard Perps: market calendar, LP vault, engine, and one keeper-written price
/// feed per stock. On a test network (no COLLATERAL) it also deploys tUSD with a faucet and seeds
/// the vault.
///
/// Env: KEEPER (address allowed to write prices), WINDOWS_JSON (closures), MARKETS_JSON
/// [script/perps-markets.json], COLLATERAL (existing 6-decimal stablecoin; unset = deploy tUSD),
/// OWNER (receives ownership; it must call acceptOwnership on calendar, vault, engine and feeds),
/// SEED [1_000_000e6, test token only], MAX_OI [250_000e6 per side], MAX_DEV_BPS [2_500]
///   forge script script/DeployPerps.s.sol --rpc-url $RPC --private-key $PK --broadcast --slow
contract DeployPerps is Script {
    struct Row {
        uint256 end;
        string label;
        uint256 start;
    }

    struct MarketRow {
        string name;
        string symbol;
    }

    function params() internal pure returns (PerpEngine.Params memory) {
        return PerpEngine.Params({
            openFeeBps: 8, closeFeeBps: 8, spreadBps: 5, maintenanceBps: 100, liquidationFeeBps: 20,
            deleverageFeeBps: 5, maxProfitBps: 90_000, borrowBpsPerDay: 3, closedBorrowMultiplier: 3,
            maxLeverage: 5, weekendMaxLeverage: 3, preCloseWindow: 2 hours, maxUtilizationBps: 8_000,
            minCollateral: 10e6
        });
    }

    struct Deployed {
        address collateral;
        bool testToken;
        MarketCalendar cal;
        PerpVault vault;
        PerpEngine engine;
        uint256 closures;
        string marketsJson;
    }

    function run() external {
        address keeper = vm.envAddress("KEEPER");
        vm.startBroadcast();
        Deployed memory d = _core(msg.sender);
        address owner_ = vm.envOr("OWNER", msg.sender);
        d.marketsJson = _markets(d.engine, keeper, owner_);
        if (d.testToken) {
            uint256 seed = vm.envOr("SEED", uint256(1_000_000e6));
            TestUSD(d.collateral).mint(msg.sender, seed);
            TestUSD(d.collateral).approve(address(d.vault), seed);
            d.vault.deposit(seed, msg.sender);
        }
        if (owner_ != msg.sender) {
            d.cal.transferOwnership(owner_);
            d.vault.transferOwnership(owner_);
            d.engine.transferOwnership(owner_);
        }
        vm.stopBroadcast();
        _write(d, keeper);
    }

    function _core(address me) internal returns (Deployed memory d) {
        d.collateral = vm.envOr("COLLATERAL", address(0));
        if (d.collateral == address(0)) {
            d.collateral = address(new TestUSD(me));
            d.testToken = true;
        }
        d.cal = new MarketCalendar(me, 0);
        Row[] memory rows = abi.decode(vm.parseJson(vm.readFile(vm.envString("WINDOWS_JSON"))), (Row[]));
        uint256 n;
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](rows.length);
        for (uint256 i; i < rows.length; ++i) {
            if (rows[i].start <= block.timestamp) continue;
            ws[n++] = MarketCalendar.Window(uint64(rows[i].start), uint64(rows[i].end));
        }
        assembly {
            mstore(ws, n)
        }
        d.cal.addClosures(ws);
        d.closures = n;
        d.vault = new PerpVault(IERC20(d.collateral), "Bellguard Perps LP", "bpLP", me);
        d.engine = new PerpEngine(IERC20(d.collateral), d.vault, d.cal, params(), me);
        d.vault.setEngine(address(d.engine));
    }

    /// @dev Feeds are owned by `feedOwner` from the start (the engine needs no feed-owner calls).
    function _markets(PerpEngine engine, address keeper, address feedOwner) internal returns (string memory json) {
        MarketRow[] memory mkts = abi.decode(
            vm.parseJson(vm.readFile(vm.envOr("MARKETS_JSON", string("script/perps-markets.json")))), (MarketRow[])
        );
        uint256 maxOi = vm.envOr("MAX_OI", uint256(250_000e6));
        uint16 maxDev = uint16(vm.envOr("MAX_DEV_BPS", uint256(2_500)));
        for (uint256 i; i < mkts.length; ++i) {
            PushPriceFeed feed = new PushPriceFeed(8, string.concat(mkts[i].symbol, " / USD"), keeper, maxDev, feedOwner);
            // Prices older than a day are rejected; the keeper mirrors every few minutes.
            uint256 id = engine.addMarket(mkts[i].symbol, IAggregatorV3(address(feed)), maxOi, 1 days);
            json = string.concat(
                json, i == 0 ? "" : ",", '{"symbol":"', mkts[i].symbol, '","name":"', mkts[i].name,
                '","market":', vm.toString(id), ',"feed":"', vm.toString(address(feed)), '"}'
            );
        }
    }

    function _write(Deployed memory d, address keeper) internal {
        string memory out = string.concat(
            '{"chainId":', vm.toString(block.chainid), ',"collateral":"', vm.toString(d.collateral),
            '","calendar":"', vm.toString(address(d.cal)), '","vault":"', vm.toString(address(d.vault)),
            '","engine":"', vm.toString(address(d.engine)), '","keeper":"', vm.toString(keeper),
            '","testToken":', d.testToken ? "true" : "false", ',"owner":"', vm.toString(vm.envOr("OWNER", msg.sender))
        );
        out = string.concat(out, '","closures":', vm.toString(d.closures), ',"markets":[', d.marketsJson, "]}");
        string memory path = string.concat("deployments/perps-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, out);
        console2.log("Wrote", path);
    }
}
