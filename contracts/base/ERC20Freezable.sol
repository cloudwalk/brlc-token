// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";
import { BRLCTokenBase } from "./BRLCTokenBase.sol";

/**
 * @title ERC20Freezable contract
 * @author CloudWalk Inc.
 * @dev The ERC20 token implementation that supports the freezing operations.
 */
abstract contract ERC20Freezable is BRLCTokenBase, IERC20Freezable {
    /// @dev The mapping of the freeze approvals.
    mapping(address => bool) private _freezeApprovals;

    /// @dev The mapping of the frozen balances.
    mapping(address => uint256) private _frozenBalances;

    // -------------------- Errors -----------------------------------

    /// @dev The token freezing operation is not approved by the account.
    error FreezingNotApproved();

    /// @dev The token freezing is already approved by the account.
    error FreezingAlreadyApproved();

    /// @dev The frozen balance is exceeded during the operation.
    error LackOfFrozenBalance();

    /// @dev The transfer amount exceeded the frozen amount.
    error TransferExceededFrozenAmount();

    // -------------------- Functions --------------------------------

    /**
     * @dev The internal initializer of the upgradable contract.
     */
    function __ERC20Freezable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCTokenBase_init_unchained();
        __ERC20Freezable_init_unchained();
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     */
    function __ERC20Freezable_init_unchained() internal onlyInitializing {}

    /**
     * @dev See {IERC20Freezable-approveFreezing}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function approveFreezing() external whenNotPaused {
        if (_freezeApprovals[_msgSender()]) {
            revert FreezingAlreadyApproved();
        }

        _freezeApprovals[_msgSender()] = true;

        emit FreezeApproval(_msgSender());
    }

    /**
     * @dev See {IERC20Freezable-freeze}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by the blacklister account.
     * - The token freezing must be approved by the `account`.
     */
    function freeze(address account, uint256 amount) external whenNotPaused onlyBlacklister {
        if (!_freezeApprovals[account]) {
            revert FreezingNotApproved();
        }

        emit Freeze(account, amount, _frozenBalances[account]);

        _frozenBalances[account] = amount;
    }

    /**
     * @dev See {IERC20Freezable-transferFrozen}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by the blacklister account.
     * - The frozen balance must be greater than the `amount`.
     */
    function transferFrozen(address from, address to, uint256 amount) public virtual whenNotPaused onlyBlacklister {
        uint256 balance = _frozenBalances[from];

        if (amount > balance) {
            revert LackOfFrozenBalance();
        }

        unchecked {
            _frozenBalances[from] -= amount;
        }

        emit FreezeTransfer(from, amount);
        emit Freeze(from, _frozenBalances[from], balance);

        _transfer(from, to, amount);
    }

    /**
     * @dev See {IERC20Freezable-freezeApproval}.
     */
    function freezeApproval(address account) external view returns (bool) {
        return _freezeApprovals[account];
    }

    /**
     * @dev See {IERC20Freezable-frozenBalance}.
     */
    function frozenBalance(address account) external view returns (uint256) {
        return _frozenBalances[account];
    }

    /**
     * @dev See {ERC20Upgradeable-_beforeTokenTransfer}.
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        uint256 frozen = _frozenBalances[from];
        if (frozen != 0) {
            if (balanceOf(from) < frozen + amount) {
                revert TransferExceededFrozenAmount();
            }
        }
    }
}
