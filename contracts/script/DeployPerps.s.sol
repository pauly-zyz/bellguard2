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

/// @notice Deploy Bellguard Perps on a test network (Elysium testnet): test stablecoin with a
/// faucet, market calendar, LP vault, engine, and one keeper-written price feed per stock.
///
/// Env: KEEPER (address allowed to write prices), WINDOWS_JSON (closures), MARKETS_JSON
/// [script/perps-markets.json], SEED [1_000_000e6 tUSD into the vault], MAX_OI [250_000e6 per side]
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
            maxLeverage: 20, weekendMaxLeverage: 5, preCloseWindow: 2 hours, maxUtilizationBps: 8_000,
            minCollateral: 10e6
        });
    }

    struct Deployed {
        TestUSD usd;
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
        d.marketsJson = _markets(d.engine, keeper, msg.sender);
        uint256 seed = vm.envOr("SEED", uint256(1_000_000e6));
        d.usd.mint(msg.sender, seed);
        d.usd.approve(address(d.vault), seed);
        d.vault.deposit(seed, msg.sender);
        vm.stopBroadcast();
        _write(d, keeper);
    }

    function _core(address me) internal returns (Deployed memory d) {
        d.usd = new TestUSD(me);
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
        d.vault = new PerpVault(IERC20(address(d.usd)), "Bellguard Perps LP", "bpLP", me);
        d.engine = new PerpEngine(IERC20(address(d.usd)), d.vault, d.cal, params(), me);
        d.vault.setEngine(address(d.engine));
    }

    function _markets(PerpEngine engine, address keeper, address me) internal returns (string memory json) {
        MarketRow[] memory mkts = abi.decode(
            vm.parseJson(vm.readFile(vm.envOr("MARKETS_JSON", string("script/perps-markets.json")))), (MarketRow[])
        );
        uint256 maxOi = vm.envOr("MAX_OI", uint256(250_000e6));
        for (uint256 i; i < mkts.length; ++i) {
            PushPriceFeed feed = new PushPriceFeed(8, string.concat(mkts[i].symbol, " / USD"), keeper, me);
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
            '{"chainId":', vm.toString(block.chainid), ',"collateral":"', vm.toString(address(d.usd)),
            '","calendar":"', vm.toString(address(d.cal)), '","vault":"', vm.toString(address(d.vault)),
            '","engine":"', vm.toString(address(d.engine)), '","keeper":"', vm.toString(keeper)
        );
        out = string.concat(out, '","closures":', vm.toString(d.closures), ',"markets":[', d.marketsJson, "]}");
        string memory path = string.concat("deployments/perps-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, out);
        console2.log("Wrote", path);
    }
}
