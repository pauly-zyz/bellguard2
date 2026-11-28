// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PushPriceFeed} from "../src/perps/PushPriceFeed.sol";

/// @notice Deploy keeper-written price feeds for markets the engine owner will add later
/// (PerpEngine.addMarket is owner-only). Feeds are owned by FEED_OWNER from the start.
/// Env: KEEPER, FEED_OWNER, MARKETS_JSON, MAX_DEV_BPS [2_500]. Writes deployments/perps-feeds-<chain>.json
contract DeployFeeds is Script {
    struct MarketRow {
        string name;
        string symbol;
    }

    function run() external {
        address keeper = vm.envAddress("KEEPER");
        address feedOwner = vm.envAddress("FEED_OWNER");
        uint16 maxDev = uint16(vm.envOr("MAX_DEV_BPS", uint256(2_500)));
        MarketRow[] memory mkts = abi.decode(vm.parseJson(vm.readFile(vm.envString("MARKETS_JSON"))), (MarketRow[]));
        vm.startBroadcast();
        string memory json = "";
        for (uint256 i; i < mkts.length; ++i) {
            PushPriceFeed feed = new PushPriceFeed(8, string.concat(mkts[i].symbol, " / USD"), keeper, maxDev, feedOwner);
            json = string.concat(json, i == 0 ? "" : ",", '{"symbol":"', mkts[i].symbol, '","feed":"', vm.toString(address(feed)), '"}');
        }
        vm.stopBroadcast();
        string memory path = string.concat("deployments/perps-feeds-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, string.concat("[", json, "]"));
        console2.log("Wrote", path);
    }
}
