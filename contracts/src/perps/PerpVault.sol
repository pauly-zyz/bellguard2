// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IPerpReserve {
    /// @notice Most the vault may still have to pay traders (sum of open positions' profit caps).
    function totalReserved() external view returns (uint256);
}

/// @title PerpVault
/// @notice Liquidity providers deposit the collateral token and take the other side of
///         every trade on PerpEngine: they receive trader losses, fees and borrow fees, and
///         pay trader profits. Each open position reserves its profit cap, and that reserve
///         cannot be withdrawn, so winning traders can always be paid.
contract PerpVault is ERC4626, Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice The engine allowed to pay out. Set once.
    address public engine;

    event EngineSet(address engine);
    event PaidOut(address indexed to, uint256 amount);

    error EngineAlreadySet();
    error NotEngine();
    error ExceedsFreeLiquidity();

    constructor(IERC20 asset_, string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
        Ownable(owner_)
    {}

    function setEngine(address engine_) external onlyOwner {
        if (engine != address(0)) revert EngineAlreadySet();
        engine = engine_;
        emit EngineSet(engine_);
    }

    /// @notice Pay a trader's profit. Only the engine.
    function payOut(address to, uint256 amount) external {
        if (msg.sender != engine) revert NotEngine();
        IERC20(asset()).safeTransfer(to, amount);
        emit PaidOut(to, amount);
    }

    /// @notice Assets not reserved for open positions.
    function freeAssets() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 reserved = engine == address(0) ? 0 : IPerpReserve(engine).totalReserved();
        return assets > reserved ? assets - reserved : 0;
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 own = super.maxWithdraw(owner_);
        uint256 free = freeAssets();
        return own < free ? own : free;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 own = super.maxRedeem(owner_);
        uint256 free = convertToShares(freeAssets());
        return own < free ? own : free;
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        if (assets > freeAssets()) revert ExceedsFreeLiquidity();
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev 6 extra share decimals make the first-depositor inflation attack uneconomic.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
