// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PerpEngine} from "../src/perps/PerpEngine.sol";
import {PushPriceFeed} from "../src/perps/PushPriceFeed.sol";

/// @notice Add markets to a live PerpEngine (one keeper-written feed each) and optionally raise
/// max leverage. Engine owner only. Feeds are owned by FEED_OWNER from the start.
///
/// Env: ENGINE, KEEPER, FEED_OWNER, MARKETS_JSON, MAX_OI [2_000e6], MAX_DEV_BPS [2_500],
///      MAX_LEVERAGE [unchanged], WEEKEND_MAX_LEVERAGE [unchanged]. Writes deployments/perps-added-<chain>.json
contract UpdatePerps is Script {
    struct MarketRow {
        string name;
        string symbol;
    }

    function run() external {
        PerpEngine engine = PerpEngine(vm.envAddress("ENGINE"));
        address keeper = vm.envAddress("KEEPER");
        address feedOwner = vm.envAddress("FEED_OWNER");
        MarketRow[] memory mkts = abi.decode(vm.parseJson(vm.readFile(vm.envString("MARKETS_JSON"))), (MarketRow[]));
        uint256 maxOi = vm.envOr("MAX_OI", uint256(2_000e6));
        uint16 maxDev = uint16(vm.envOr("MAX_DEV_BPS", uint256(2_500)));

        vm.startBroadcast();
        string memory json = "";
        for (uint256 i; i < mkts.length; ++i) {
            PushPriceFeed feed = new PushPriceFeed(8, string.concat(mkts[i].symbol, " / USD"), keeper, maxDev, feedOwner);
            uint256 id = engine.addMarket(mkts[i].symbol, IAggregatorV3(address(feed)), maxOi, 1 days);
            json = string.concat(
                json, i == 0 ? "" : ",", '{"symbol":"', mkts[i].symbol, '","name":"', mkts[i].name,
                '","market":', vm.toString(id), ',"feed":"', vm.toString(address(feed)), '"}'
            );
        }
        uint256 lev = vm.envOr("MAX_LEVERAGE", uint256(0));
        if (lev != 0) {
            PerpEngine.Params memory p = engine.getParams();
            p.maxLeverage = uint16(lev);
            p.weekendMaxLeverage = uint16(vm.envOr("WEEKEND_MAX_LEVERAGE", uint256(p.weekendMaxLeverage)));
            engine.setParams(p);
        }
        vm.stopBroadcast();

        string memory path = string.concat("deployments/perps-added-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, string.concat("[", json, "]"));
        console2.log("markets now", engine.marketCount());
        console2.log("Wrote", path);
    }
}
