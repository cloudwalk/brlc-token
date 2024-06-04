// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Referenceable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports referenced operations
 */
abstract contract ERC20Referenceable is ERC20Base {
    enum ReferenceStatus {
        Pending,
        Executed
    }

    struct Reference {
        ReferenceStatus status;
        address receiver;
        uint256 amount;
    }

    // id => reference data
    mapping(bytes32 => Reference) internal _accountReferences;

    // user => total amount on all references
    mapping(address => uint256) internal _totalReferencedFromAccount;

    event AccountReferenceIncrease(bytes32 id, address account, uint256 amount);
    event AccountReferenceDecrease(bytes32 id, address account, uint256 amount);

    error InvalidAmount();
    error InvalidReferenceId();
    error AlreadyExecuted();
    error TransferExceededReferencedAmount();

    function increaseAccountReference(bytes32 id, address account, uint256 amount) external {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if(_accountReferences[id].status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }

        _accountReferences[account].amount += amount;
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
        if(_accountReferences[id].status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }
        if (_accountReferences[account].amount < amount) {
            revert InvalidAmount();
        }

        _accountReferences[account].amount -= amount;
        _totalReferencedFromAccount[account] -= amount;

        emit AccountReferenceDecrease(id, account, amount);
    }

    function transferWithId(address account, uint256 amount, bytes32 id) external {
        Reference storage ref = _accountReferences[id];
        if (ref.status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }
        if (ref.amount != amount) {
            revert InvalidReferenceId();
        }

        ref.amount -= amount;
        transfer(account, amount);
        ref.status = ReferenceStatus.Executed;
    }

    function transferFromWithId(address sender, address receiver, uint256 amount, bytes32 id) external {
        Reference storage ref = _accountReferences[id];
        if (ref.status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }
        if (ref.amount != amount) {
            revert InvalidReferenceId();
        }

        ref.amount -= amount;
        transferFrom(sender, receiver, amount);
        ref.status = ReferenceStatus.Executed;
    }

    function getAccountReferencesById(address account, bytes32 id) external view returns (Reference memory) {
        return _accountReferences[id];
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