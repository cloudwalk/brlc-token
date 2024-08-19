// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Freezable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports the freezing operations
 */
abstract contract ERC20Freezable is ERC20Base, IERC20Freezable {
    /// @notice The mapping of the freeze approvals
    mapping(address => bool) private _freezeApprovals;

    /// @notice The mapping of the frozen balances
    mapping(address => uint256) private _frozenBalances;

    // -------------------- Errors -----------------------------------

    /// @notice The token freezing operation is not approved by the account
    error FreezingNotApproved();

    /// @notice The token freezing is already approved by the account
    error FreezingAlreadyApproved();

    /// @notice The frozen balance is exceeded during the operation
    error LackOfFrozenBalance();

    /// @notice The transfer amount exceeded the frozen amount
    error TransferExceededFrozenAmount();

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __ERC20Freezable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Freezable_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     */
    function __ERC20Freezable_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IERC20Freezable
     *
     * @notice The contract must not be paused
     */
    function approveFreezing() external whenNotPaused {
        if (_freezeApprovals[_msgSender()]) {
            revert FreezingAlreadyApproved();
        }

        _freezeApprovals[_msgSender()] = true;

        emit FreezeApproval(_msgSender());
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by the blocklister account
     * @dev The token freezing must be approved by the `account`
     */
    function freeze(address account, uint256 amount) external whenNotPaused onlyBlocklister {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (!_freezeApprovals[account]) {
            revert FreezingNotApproved();
        }

        emit Freeze(account, amount, _frozenBalances[account]);

        _frozenBalances[account] = amount;
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by the blocklister account
     * @dev The frozen balance must be greater than the `amount`
     */
    function transferFrozen(address from, address to, uint256 amount) public virtual whenNotPaused onlyBlocklister {
        uint256 oldFrozenBalance = _frozenBalances[from];

        if (amount > oldFrozenBalance) {
            revert LackOfFrozenBalance();
        }

        uint256 newFrozenBalance;
        unchecked {
            newFrozenBalance = oldFrozenBalance - amount;
        }

        emit FreezeTransfer(from, amount);
        emit Freeze(from, newFrozenBalance, oldFrozenBalance);

        _frozenBalances[from] = newFrozenBalance;
        _transfer(from, to, amount);
    }

    /**
     * @inheritdoc IERC20Freezable
     */
    function freezeIncrease(address account, uint256 amount) external onlyBlocklister {
        if (amount == 0) {
            revert ZeroAmount();
        }

        _freezeChange(account, amount, true);
    }

    /**
     * @inheritdoc IERC20Freezable
     */
    function freezeDecrease(address account, uint256 amount) external onlyBlocklister {
        if (amount == 0) {
            revert ZeroAmount();
        }

        _freezeChange(account, amount, false);
    }

    function _freezeChange(address account, uint256 amount, bool increasing) internal onlyBlocklister {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (!_freezeApprovals[account]) {
            revert FreezingNotApproved();
        }

        uint256 oldBalance = _frozenBalances[account];
        uint256 newBalance;

        if (increasing) {
            newBalance = oldBalance + amount;
        } else if (!increasing && amount <= oldBalance) {
            newBalance = oldBalance - amount;
        } else {
            revert LackOfFrozenBalance();
        }

        _frozenBalances[account] = newBalance;

        emit Freeze(account, newBalance, oldBalance);
    }

    /**
     * @inheritdoc IERC20Freezable
     */
    function freezeApproval(address account) external view returns (bool) {
        return _freezeApprovals[account];
    }

    /**
     * @inheritdoc IERC20Freezable
     */
    function balanceOfFrozen(address account) public view returns (uint256) {
        return _frozenBalances[account];
    }

    /**
     * @dev [DEPRECATED] Keep this function for backward compatibility
     */
    function frozenBalance(address account) public view returns (uint256) {
        return balanceOfFrozen(account);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[48] private __gap;
}
