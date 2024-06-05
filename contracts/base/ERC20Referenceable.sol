// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Referenceable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports referenced operations
 */
abstract contract ERC20Referenceable is ERC20Base {
    // account => id => amount
    mapping(address => mapping(bytes32 => uint64)) internal _referencedAmounts;

    // user => total amount on all references
    mapping(address => uint256) internal _totalReferencedFromAccount;

    event ReferenceCreated(bytes32 id, address sender, uint256 amount);
    event ReferenceUpdated(bytes32 id, uint256 newAmount, uint256 oldAmount);

    error InvalidReferenceId();
    error TransferExceededReferencedAmount();

    function createReference(bytes32 id, address account, uint256 amount) external {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        _referencedAmounts[account][id] = uint64(amount);
        _totalReferencedFromAccount[account] += amount;

        emit ReferenceCreated(id, account, amount);
    }

    function updateReference(bytes32 id, address account, uint256 newAmount) external {
        if (newAmount == 0) {
            revert ZeroAmount();
        }

        uint64 oldAmount = _referencedAmounts[account][id];
        _totalReferencedFromAccount[account] -= oldAmount;
        _referencedAmounts[account][id] = uint64(newAmount);
        _totalReferencedFromAccount[account] += newAmount;

        emit ReferenceUpdated(id, newAmount, oldAmount);
    }

    function transferFromWithId(address sender, address receiver, uint256 amount, bytes32 id) external {
        // todo add checks

        _referencedAmounts[sender][id] -= uint64(amount); // todo add safecast in future
        transferFrom(sender, receiver, amount);
    }

    function getAccountReferencesById(address account, bytes32 id) external view returns (uint256) {
        return _referencedAmounts[account][id];
    }

    function balanceOfReferenced(address account) public view returns (uint256) {
        return _totalReferencedFromAccount[account];
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        // Execute basic transfer logic
        super._afterTokenTransfer(from, to, amount);

        // check spender`s total referenced balance
        uint256 totalReferencedBalance = _totalReferencedFromAccount[from];

        // if there are some referenced funds
        if (totalReferencedBalance != 0) {
            // Execute basic transfer logic
            super._afterTokenTransfer(from, to, amount);

            // revert if transfer exceeded referenced amount
            if (_balanceOf_ERC20Referenceable(from) < totalReferencedBalance) {
                revert TransferExceededReferencedAmount();
            }
        }
    }

    function _balanceOf_ERC20Referenceable(address account) internal view virtual returns (uint256);

    uint256[48] private __gap;
}