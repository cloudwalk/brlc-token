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
        address sender;
        address receiver;
        uint256 amount;
    }

    // id => reference data
    mapping(bytes32 => Reference) internal _accountReferences;

    // user => total amount on all references
    mapping(address => uint256) internal _totalReferencedFromAccount;

    event ReferenceCreated(bytes32 id, address sender, address receiver, uint256 amount);
    event ReferenceUpdated(bytes32 id);

    error InvalidAmount();
    error InvalidReferenceId();
    error AlreadyExecuted();
    error TransferExceededReferencedAmount();

    function configureReference(bytes32 id, address sender, address receiver, uint256 amount) external {
        if (sender == address(0) || receiver == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (_accountReferences[id].status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }

        uint256 oldAmount = _accountReferences[id].amount;

        _accountReferences[id] = Reference({
            status : ReferenceStatus.Pending,
            sender : sender,
            receiver : receiver,
            amount : amount
        });

        _totalReferencedFromAccount[sender] = _totalReferencedFromAccount[sender] - oldAmount + amount;

        emit ReferenceCreated(id, sender, receiver, amount);
    }

    function transferFromWithId(bytes32 id) external {
        Reference storage ref = _accountReferences[id];
        if (ref.status == ReferenceStatus.Executed) {
            revert AlreadyExecuted();
        }

        ref.status = ReferenceStatus.Executed;
        _totalReferencedFromAccount[ref.sender] -= ref.amount;
        transferFrom(ref.sender, ref.receiver, ref.amount);
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