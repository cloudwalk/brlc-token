// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Freezable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The ERC20 token implementation that supports the freezing operations
 */
abstract contract ERC20Freezable is ERC20Base, IERC20Freezable {
    // ------------------ Constants ------------------------------- //

    /// @notice The role of a balance freezer that is allowed to freeze or unfreeze tokens of other accounts.
    bytes32 public constant BALANCE_FREEZER_ROLE = keccak256("BALANCE_FREEZER_ROLE");

    /// @notice The role of a frozen balance transferor that is allowed to transfer previously frozen tokens.
    bytes32 public constant FROZEN_TRANSFEROR_ROLE = keccak256("FROZEN_TRANSFEROR_ROLE");

    // ------------------ Types ----------------------------------- //

    /**
     * @dev Possible types of a frozen balance update operation
     *
     * The values:
     *
     * - Increase = 0 ----- To increase the frozen balance by the provided amount.
     * - Decrease = 1 ----- To decrease the frozen balance by the provided amount.
     * - Replacement = 2 -- To replace the frozen balance with the provided amount.
     */
    enum FrozenBalanceUpdateType {
        Increase,
        Decrease,
        Replacement
    }

    // ------------------ Storage variables ----------------------- //

    /// @notice [DEPRECATED] The mapping of the freeze approvals. No longer in use
    mapping(address => bool) private _freezeApprovals;

    /// @notice The mapping of the frozen balances
    mapping(address => uint256) private _frozenBalances;

    /// @notice [DEPRECATED] The mapping of the configured freezers. No longer in use.
    ///         Replaced with `BALANCE_FREEZER_ROLE` or `FROZEN_TRANSFEROR_ROLE`.
    mapping(address => bool) private _freezers;

    // -------------------- Errors -------------------------------- //

    /// @notice [DEPRECATED] The token freezing operation is not approved by the account. No longer in use
    /// @dev Kept for backward compatibility with transaction analysis tools
    error FreezingNotApproved();

    /// @notice [DEPRECATED] The token freezing is already approved by the account. No longer in use
    /// @dev Kept for backward compatibility with transaction analysis tools
    error FreezingAlreadyApproved();

    /// @notice The frozen balance is exceeded during the operation
    error LackOfFrozenBalance();

    /// @notice The transfer amount exceeded the frozen amount
    error TransferExceededFrozenAmount();

    /// @notice [DEPRECATED] The transaction sender is not a freezer. No longer in use
    /// @dev Kept for backward compatibility with transaction analysis tools.
    ///      Replaced by an appropriate error from the `AccessControl` library smart contract.
    error UnauthorizedFreezer();

    /// @notice The provided address belongs to a contract so its balance cannot be frozen
    error ContractBalanceFreezingAttempt();

    // -------------------- Initializers -------------------------- //

    /**
     * @notice The internal unchained initializer of the upgradeable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __ERC20Freezable_init_unchained() internal onlyInitializing {
        _setRoleAdmin(BALANCE_FREEZER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(FROZEN_TRANSFEROR_ROLE, GRANTOR_ROLE);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev [DEPRECATED] Approves token freezing for the caller
     *
     * IMPORTANT: This function is deprecated and will be removed in the future updates of the contract.
     *            For now it is kept for backward compatibility
     */
    function approveFreezing() external {}

    /**
     * @notice [DEPRECATED] Updates the frozen balance of an account
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
     *
     * @param account The account to update the frozen balance for
     * @param amount The amount of tokens to set as the new frozen balance
     * @return newBalance The frozen balance of the account after the update
     * @return oldBalance The frozen balance of the account before the update
     */
    function freeze(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(BALANCE_FREEZER_ROLE) returns (uint256 newBalance, uint256 oldBalance) {
        return _updateFrozen(account, amount, uint256(FrozenBalanceUpdateType.Replacement));
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a freezer
     * @dev The account address must not be zero
     * @dev The amount must not be zero
     */
    function freezeIncrease(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(BALANCE_FREEZER_ROLE) returns (uint256 newBalance, uint256 oldBalance) {
        return _updateFrozen(account, amount, uint256(FrozenBalanceUpdateType.Increase));
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a freezer
     * @dev The account address must not be zero
     * @dev The amount must not be zero
     */
    function freezeDecrease(
        address account,
        uint256 amount
    ) external whenNotPaused onlyRole(BALANCE_FREEZER_ROLE) returns (uint256 newBalance, uint256 oldBalance) {
        return _updateFrozen(account, amount, uint256(FrozenBalanceUpdateType.Decrease));
    }

    /**
     * @inheritdoc IERC20Freezable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a freezer
     * @dev The frozen balance must be greater than the `amount`
     */
    function transferFrozen(
        address from,
        address to,
        uint256 amount
    ) public virtual whenNotPaused onlyRole(FROZEN_TRANSFEROR_ROLE) returns (uint256 newBalance, uint256 oldBalance) {
        oldBalance = _frozenBalances[from];

        if (amount > oldBalance) {
            revert LackOfFrozenBalance();
        }

        unchecked {
            newBalance = oldBalance - amount;
        }

        emit FreezeTransfer(from, amount);
        emit Freeze(from, newBalance, oldBalance);

        _frozenBalances[from] = newBalance;
        _transfer(from, to, amount);
    }

    // ------------------ View functions -------------------------- //

    /**
     * @notice [DEPRECATED] Checks if token freezing is approved for an account
     *
     * IMPORTANT: This function is deprecated and will be removed in the future updates of the contract.
     *            For now it is kept for backward compatibility
     *
     * @param account The account to check the approval for
     * @return True if token freezing is approved for the account
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

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Updates the frozen balance
     */
    function _freeze(address account, uint256 newBalance, uint256 oldBalance) internal {
        emit Freeze(account, newBalance, oldBalance);
        _frozenBalances[account] = newBalance;
    }

    /**
     * @dev Updates the frozen balance of an account internally according to the amount and the update operation type
     */
    function _updateFrozen(
        address account,
        uint256 amount,
        uint256 updateType
    ) internal returns (uint256 newBalance, uint256 oldBalance) {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (updateType == uint256(FrozenBalanceUpdateType.Replacement)) {
            oldBalance = _frozenBalances[account];
            newBalance = amount;
        } else {
            if (amount == 0) {
                revert ZeroAmount();
            }

            oldBalance = _frozenBalances[account];
            newBalance = oldBalance;

            if (updateType == uint256(FrozenBalanceUpdateType.Increase)) {
                newBalance += amount;
            } else {
                if (amount > oldBalance) {
                    revert LackOfFrozenBalance();
                }
                unchecked {
                    newBalance -= amount;
                }
            }
        }
        if (newBalance != 0 && account.code.length != 0) {
            revert ContractBalanceFreezingAttempt();
        }
        _freeze(account, newBalance, oldBalance);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[47] private __gap;
}
