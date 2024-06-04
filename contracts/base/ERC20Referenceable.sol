// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Referenceable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports referenced operations
 */
abstract contract ERC20Referenceable is ERC20Base {
    struct Reference {
        address receiver;
        uint256 amount;
    }

    // user => id => amount
    mapping(bytes32 => Reference) internal _accountReferences;

    // user => total amount on all references
    mapping(address => uint256) internal _totalReferencedFromAccount;

    event AccountReferenceIncrease(bytes32 id, address account, uint256 amount);
    event AccountReferenceDecrease(bytes32 id, address account, uint256 amount);

    error InvalidAmount();
    error UnsupportedReferenceId();
    error TransferExceededReferencedAmount();

    function increaseAccountReference(bytes32 id, address account, uint256 amount) external {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        _accountReferences[account][id] += amount;
        _totalReferencedFromAccount[account] += amount;

        emit AccountReferenceIncrease(id, account, amount);
    }

    function decreaseAccountReference(bytes32 id, address account, uint256 amount) external {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (_accountReferences[account][id] < amount) {
            revert InvalidAmount();
        }
        _accountReferences[account][id] -= amount;
        _totalReferencedFromAccount[account] -= amount;

        emit AccountReferenceDecrease(id, account, amount);
    }

    function getAccountReferencesById(address account, bytes32 id) external view returns (uint256) {
        return _accountReferences[account][id];
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
            // get all configured references array
            bytes32[] memory references = _referencedId[to];

            for (uint256 i = 0; i < references.length; i++) {
                // get reference for iteration
                bytes32 referenceId = references[i];
                // get configured amount for this reference
                uint256 referencedBalance = _accountReferences[from][referenceId];

                // if some balance is referenced
                if (referencedBalance != 0) {
                    // if transfer to referenced receiver and referenced balance is bigger than transfer amount
                    if (_references[referenceId].receiver == to && amount < referencedBalance) {
                        referencedBalance -= amount;
                        totalReferencedBalance -= amount;
                        // if transfer to referenced receiver and referenced balance is less than transfer amount
                    } else if (_references[referenceId].receiver == to && amount >= referencedBalance) {
                        totalReferencedBalance -= referencedBalance;
                        referencedBalance = 0;
                    }

                    // check reference flag and perform additional actions if needed
                    if (_references[referenceId].flag == ReferenceFlag.One) {
                        // do something
                    }
                }

            }

            // revert if transfer exceeded referenced amount
            if (_balanceOf_ERC20Referenceable(from) < totalReferencedBalance) {
                revert TransferExceededReferencedAmount();
            }
        }
    }

    function _balanceOf_ERC20Referenceable(address account) internal view virtual returns (uint256);

    uint256[45] private __gap;
}