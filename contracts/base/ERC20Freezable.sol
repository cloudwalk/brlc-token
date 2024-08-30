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

    /// @notice The mapping of the configured freezers
    mapping(address => bool) private _freezers;

    // -------------------- Errors -----------------------------------

    /// @notice The token freezing operation is not approved by the account
    error FreezingNotApproved();

    /// @notice The token freezing is already approved by the account
    error FreezingAlreadyApproved();

    /// @notice The frozen balance is exceeded during the operation
    error LackOfFrozenBalance();

    /// @notice The transfer amount exceeded the frozen amount
    error TransferExceededFrozenAmount();

    /// @notice The transaction sender is not a freezer
    error UnauthorizedFreezer();

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the freezer
     */
    modifier onlyFreezer() {
        if (!_freezers[_msgSender()]) {
            revert UnauthorizedFreezer();
        }
        _;
    }

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
     * @dev The contract must not be paused
     * @dev Can only be called by the owner
     * @dev Each freezer from the array must not be already have the provided status
     * @dev NOTE: The previous function name was: `configureFreezers()`
     */
    function configureFreezerBatch(
        address[] calldata freezers, // Tools: this comment prevents Prettier from formatting into a single line.
        bool status
    ) external whenNotPaused onlyOwner {
        for (uint256 i = 0; i < freezers.length; i++) {
            _configureFreezer(freezers[i], status); // reverts if the freezer is already configured
        }
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev The caller must not be already approved for freezing
     */
    function approveFreezing() external whenNotPaused {
        if (_freezeApprovals[_msgSender()]) {
            revert FreezingAlreadyApproved();
        }

        _freezeApprovals[_msgSender()] = true;

        emit FreezeApproval(_msgSender());
    }

    /**
     * @dev [DEPRECATED] Freezes tokens of the specified account
     *
     * Emits a {Freeze} event
     *
     * IMPORTANT: This function is deprecated and will be removed in the future updates of the contract.
     *            Use the {freezeIncrease} and {freezeDecrease} functions instead.
     *
     * Requirements:
     *
     * - The contract must not be paused
     * - Can only be called by a freezer
     * - The account address must not be zero
     * - The token freezing must be approved by the `account`
     *
     * @param account The account whose tokens will be frozen
     * @param amount The amount of tokens to freeze
     */
    function freeze(address account, uint256 amount) external whenNotPaused onlyFreezer {
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
     * @dev Can only be called by a freezer
     * @dev The account address must not be zero
     * @dev The amount must not be zero
     * @dev The token freezing must be approved by the `account`
     */
    function freezeIncrease(address account, uint256 amount) external whenNotPaused onlyFreezer {
        _freezeChange(
            account,
            amount,
            true // increasing
        );
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a freezer
     * @dev The account address must not be zero
     * @dev The amount must not be zero
     * @dev The token freezing must be approved by the `account`
     */
    function freezeDecrease(address account, uint256 amount) external whenNotPaused onlyFreezer {
        _freezeChange(
            account,
            amount,
            false // decreasing
        );
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a freezer
     * @dev The frozen balance must be greater than the `amount`
     */
    function transferFrozen(address from, address to, uint256 amount) public virtual whenNotPaused onlyFreezer {
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
    function isFreezer(address account) external view returns (bool) {
        return _freezers[account];
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
     * @dev Configures a freezer internally
     */
    function _configureFreezer(address freezer, bool status) internal {
        if (_freezers[freezer] == status) {
            revert AlreadyConfigured();
        }

        _freezers[freezer] = status;

        if (status == true) {
            emit FreezerAssigned(freezer);
        } else {
            emit FreezerRemoved(freezer);
        }
    }

    /**
     * @dev Changes the frozen balance internally
     */
    function _freezeChange(address account, uint256 amount, bool increasing) internal {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (!_freezeApprovals[account]) {
            revert FreezingNotApproved();
        }

        uint256 oldBalance = _frozenBalances[account];
        uint256 newBalance = oldBalance;

        if (increasing) {
            newBalance += amount;
        } else {
            if (amount > oldBalance) {
                revert LackOfFrozenBalance();
            }
            unchecked {
                newBalance -= amount;
            }
        }

        _frozenBalances[account] = newBalance;

        emit Freeze(account, newBalance, oldBalance);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[47] private __gap;
}
