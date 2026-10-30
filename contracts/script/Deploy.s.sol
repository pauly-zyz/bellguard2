// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

import {BellguardClaims} from "../src/BellguardClaims.sol";
import {BellguardHook} from "../src/BellguardHook.sol";
import {CoverVault} from "../src/CoverVault.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice Deploys MarketCalendar, CoverVault, BellguardHook (mined address) and BellguardClaims.
///
/// Required env: USDG, POSITION_MANAGER, OWNER, TREASURY
/// Optional env (defaults in brackets):
///   POOL_MANAGER [Robinhood Chain v4 PoolManager], CALENDAR_NOTICE [3600],
///   LOCK_AFTER_REOPEN [345600 = 4 days], SETTLE_DELAY [3600], SETTLE_SLOT [7200],
///   CLAIM_PERIOD [172800 = 2 days], MAX_PRICE_AGE [3600], CLOSED_BPS [30],
///   DEDUCTIBLE_BPS [25], CAP_BPS [500], MAX_WINDOW_BPS [2000]
///
/// The calendar starts owned by the deployer so PublishCalendar can run next;
/// hand it to OWNER afterwards (two-step: OWNER must call acceptOwnership).
///
///   forge script script/Deploy.s.sol --rpc-url $RPC --account deployer --broadcast
abstract contract DeployBase is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant DEFAULT_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    uint160 constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    struct Deployed {
        MarketCalendar calendar;
        CoverVault vault;
        BellguardHook hook;
        BellguardClaims claims;
    }

    /// @param admin temporary owner (the deployer): keeps the calendar so windows can be
    ///              published right away, and wires the vault before handing it to `owner`
    /// @param create2Deployer the CREATE2 factory when broadcasting; the script itself in tests
    function deploy(
        address usdg,
        address positionManager,
        address owner,
        address treasury,
        address admin,
        address create2Deployer
    ) internal returns (Deployed memory d) {
        d.calendar = new MarketCalendar(admin, vm.envOr("CALENDAR_NOTICE", uint256(1 hours)));
        d.vault = new CoverVault(IERC20(usdg), d.calendar, vm.envOr("LOCK_AFTER_REOPEN", uint256(4 days)), admin);
        d.hook = _deployHook(d, usdg, treasury, owner, create2Deployer);
        d.claims = _deployClaims(d, positionManager, owner);
        d.vault.setClaims(address(d.claims));
        d.vault.transferOwnership(owner);

        console2.log("MarketCalendar ", address(d.calendar));
        console2.log("CoverVault     ", address(d.vault));
        console2.log("BellguardHook  ", address(d.hook));
        console2.log("BellguardClaims", address(d.claims));
    }

    function _deployHook(Deployed memory d, address usdg, address treasury, address owner, address create2Deployer)
        private
        returns (BellguardHook hook)
    {
        IPoolManager manager = IPoolManager(vm.envOr("POOL_MANAGER", DEFAULT_POOL_MANAGER));
        uint16 closedBps = uint16(vm.envOr("CLOSED_BPS", uint256(30)));
        bytes memory args =
            abi.encode(manager, d.calendar, Currency.wrap(usdg), address(d.vault), treasury, closedBps, owner);
        (address hookAddr, bytes32 salt) =
            HookMiner.find(create2Deployer, HOOK_FLAGS, type(BellguardHook).creationCode, args);
        hook = new BellguardHook{salt: salt}(
            manager, d.calendar, Currency.wrap(usdg), address(d.vault), treasury, closedBps, owner
        );
        require(address(hook) == hookAddr, "hook address mismatch");
    }

    function _deployClaims(Deployed memory d, address positionManager, address owner)
        private
        returns (BellguardClaims)
    {
        BellguardClaims.Terms memory terms = BellguardClaims.Terms({
            deductibleBps: uint16(vm.envOr("DEDUCTIBLE_BPS", uint256(25))),
            capBps: uint16(vm.envOr("CAP_BPS", uint256(500))),
            maxWindowBps: uint16(vm.envOr("MAX_WINDOW_BPS", uint256(2000)))
        });
        return new BellguardClaims(
            d.hook,
            d.vault,
            positionManager,
            vm.envOr("SETTLE_DELAY", uint256(1 hours)),
            vm.envOr("SETTLE_SLOT", uint256(2 hours)),
            vm.envOr("CLAIM_PERIOD", uint256(2 days)),
            vm.envOr("MAX_PRICE_AGE", uint256(1 hours)),
            terms,
            owner
        );
    }

    function write(Deployed memory d, address usdg) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "usdg", usdg);
        vm.serializeAddress(k, "poolManager", vm.envOr("POOL_MANAGER", DEFAULT_POOL_MANAGER));
        vm.serializeAddress(k, "calendar", address(d.calendar));
        vm.serializeAddress(k, "vault", address(d.vault));
        vm.serializeAddress(k, "hook", address(d.hook));
        string memory json = vm.serializeAddress(k, "claims", address(d.claims));
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
    }
}

contract Deploy is DeployBase {
    function run() external returns (Deployed memory d) {
        address usdg = vm.envAddress("USDG");
        address owner = vm.envAddress("OWNER");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        d = deploy(usdg, vm.envAddress("POSITION_MANAGER"), owner, vm.envAddress("TREASURY"), deployer, CREATE2_DEPLOYER);
        vm.stopBroadcast();
        write(d, usdg);
    }
}
