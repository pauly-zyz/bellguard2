// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {MarketCalendar} from "./MarketCalendar.sol";

/// @title CoverVault
/// @notice Underwriters deposit USDG and receive shares. Swap premiums from
///         BellguardHook flow straight in, raising the share price. Approved
///         claims are paid out of the vault.
///
/// Withdrawals are locked while the market is closed and for `lockAfterReopen`
/// seconds after each reopen, so underwriters can't leave just before a gap is
/// settled. Deposits are always open.
contract CoverVault is ERC4626, Ownable2Step {
    using SafeERC20 for IERC20;

    MarketCalendar public immutable calendar;
    uint256 public immutable lockAfterReopen;

    /// @notice The claims contract allowed to pay out. Set once.
    address public claims;

    event ClaimsSet(address claims);
    event ClaimPaid(address indexed to, uint256 amount);

    error ClaimsAlreadySet();
    error NotClaims();
    error WithdrawalsLocked();

    constructor(IERC20 usdg, MarketCalendar calendar_, uint256 lockAfterReopen_, address owner_)
        ERC20("Bellguard Cover Vault USDG", "bgUSDG")
        ERC4626(usdg)
        Ownable(owner_)
    {
        calendar = calendar_;
        lockAfterReopen = lockAfterReopen_;
    }

    function setClaims(address claims_) external onlyOwner {
        if (claims != address(0)) revert ClaimsAlreadySet();
        claims = claims_;
        emit ClaimsSet(claims_);
    }

    /// @notice Pay an approved claim. Only callable by the claims contract.
    function payClaim(address to, uint256 amount) external {
        if (msg.sender != claims) revert NotClaims();
        IERC20(asset()).safeTransfer(to, amount);
        emit ClaimPaid(to, amount);
    }

    /// @notice True while underwriters cannot withdraw.
    function isLocked() public view returns (bool) {
        if (calendar.isClosedNow()) return true;
        uint256 lastEnd = calendar.lastClosureEnd(block.timestamp);
        return lastEnd != 0 && block.timestamp < lastEnd + lockAfterReopen;
    }

    // ERC-4626: report zero withdrawable while locked (keeps integrations honest).
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return isLocked() ? 0 : super.maxWithdraw(owner_);
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return isLocked() ? 0 : super.maxRedeem(owner_);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        if (isLocked()) revert WithdrawalsLocked();
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev Virtual-share offset against the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
