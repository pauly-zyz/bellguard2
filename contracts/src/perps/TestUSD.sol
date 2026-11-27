// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSD
/// @notice Testnet-only stablecoin with a public faucet. Worth nothing.
contract TestUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastClaim;
    /// @notice Can mint without limit, to seed test liquidity.
    address public immutable minter;

    error TooSoon();
    error NotMinter();

    constructor(address minter_) ERC20("Bellguard Test USD", "tUSD") {
        minter = minter_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint 10,000 tUSD to the caller, at most once an hour.
    function faucet() external {
        if (block.timestamp < lastClaim[msg.sender] + FAUCET_COOLDOWN) revert TooSoon();
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
