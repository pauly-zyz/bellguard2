// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title PushPriceFeed
/// @notice A Chainlink-compatible price feed written by a trusted updater. Used on chains
///         without a stock oracle (Elysium testnet): a keeper copies each Chainlink answer
///         and its original timestamp from the source chain. Trust sits with the updater,
///         so this is for testing only; production markets should read a real oracle.
contract PushPriceFeed is IAggregatorV3, Ownable2Step {
    uint8 public immutable override decimals;
    string public override description;
    address public updater;

    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _updatedAt;

    event UpdaterSet(address updater);
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error NotUpdater();
    error BadAnswer();
    error StaleOrFuture();

    constructor(uint8 decimals_, string memory description_, address updater_, address owner_) Ownable(owner_) {
        decimals = decimals_;
        description = description_;
        updater = updater_;
    }

    function setUpdater(address updater_) external onlyOwner {
        updater = updater_;
        emit UpdaterSet(updater_);
    }

    /// @notice Publish a price observed at `updatedAt` (must be newer than the last one).
    function update(int256 answer, uint256 updatedAt) external {
        if (msg.sender != updater) revert NotUpdater();
        if (answer <= 0) revert BadAnswer();
        if (updatedAt <= _updatedAt || updatedAt > block.timestamp) revert StaleOrFuture();
        _roundId++;
        _answer = answer;
        _updatedAt = updatedAt;
        emit AnswerUpdated(answer, _roundId, updatedAt);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
