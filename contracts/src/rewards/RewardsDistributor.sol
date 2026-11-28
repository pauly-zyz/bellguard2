// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title RewardsDistributor
/// @notice Weekly holder rewards in USDC, claimed with a Merkle proof. Each week the owner
///         publishes a root over (account, cumulative amount) pairs: the total each account has
///         earned since the start. A claim pays the difference to what the account has already
///         claimed, so one claim collects every unclaimed week. Leaves follow OpenZeppelin's
///         StandardMerkleTree: keccak256(bytes.concat(keccak256(abi.encode(account, cumulative)))).
contract RewardsDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public merkleRoot;
    uint256 public epoch; // last published week
    mapping(address => uint256) public claimed;

    event RootPublished(uint256 indexed epoch, bytes32 root);
    event Claimed(address indexed account, uint256 amount, uint256 cumulative);
    event Swept(address indexed to, uint256 amount);

    error StaleEpoch();
    error InvalidProof();
    error NothingToClaim();

    constructor(IERC20 token_, address owner_) Ownable(owner_) {
        token = token_;
    }

    /// @notice Publish the cumulative rewards tree for week `epoch_` (must move forward).
    ///         Fund the contract with the week's USDC before or with this call.
    function publish(uint256 epoch_, bytes32 root) external onlyOwner {
        if (epoch_ <= epoch) revert StaleEpoch();
        epoch = epoch_;
        merkleRoot = root;
        emit RootPublished(epoch_, root);
    }

    /// @notice Pay `account` everything it has earned and not yet claimed. Anyone can submit it.
    function claim(address account, uint256 cumulative, bytes32[] calldata proof) external {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulative))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
        uint256 already = claimed[account];
        if (cumulative <= already) revert NothingToClaim();
        uint256 amount = cumulative - already;
        claimed[account] = cumulative;
        token.safeTransfer(account, amount);
        emit Claimed(account, amount, cumulative);
    }

    /// @notice Owner recovers tokens (for example rewards nobody claimed for a long time).
    function sweep(address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
        emit Swept(to, amount);
    }
}
