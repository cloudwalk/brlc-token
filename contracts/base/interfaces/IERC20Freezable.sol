// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Freezable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports freezing operations
 */
interface IERC20Freezable {
    /**
     * @notice Emitted when token freezing has been approved for an account
     *
     * @param account The account for which token freezing has been approved
     */
    event FreezeApproval(address indexed account);

    /**
     * @notice Emitted when frozen tokens have been transferred from an account
     *
     * @param account The account from which frozen tokens have been transferred
     * @param amount The amount of frozen tokens transferred
     */
    event FreezeTransfer(address indexed account, uint256 amount);

    /**
     * @notice Emitted when token freezing has been performed for a specific account
     *
     * @param account The account for which token freezing has been performed
     * @param newFrozenBalance The updated frozen balance of the account
     * @param oldFrozenBalance The previous frozen balance of the account
     */
    event Freeze(address indexed account, uint256 newFrozenBalance, uint256 oldFrozenBalance);

    /**
     * @notice Emitted when the frozen balance is updated for an account
     *
     * @param account The account the frozen is updated for
     * @param newBalance The new frozen balance
     * @param oldBalance The old frozen balance
     */
    event FrozenBalanceUpdated(address indexed account, uint256 newBalance, uint256 oldBalance);

    /**
     * @notice Approves token freezing for the caller
     *
     * Emits a {FreezeApproval} event
     */
    function approveFreezing() external;

    /**
     * @notice Freezes tokens of the specified account
     *
     * Emits a {Freeze} event
     *
     * @param account The account whose tokens will be frozen
     * @param amount The amount of tokens to freeze
     */
    function freeze(address account, uint256 amount) external;

    /**
     * @notice Transfers frozen tokens on behalf of an account
     *
     * Emits a {FreezeTransfer} event
     *
     * @param from The account tokens will be transferred from
     * @param to The account tokens will be transferred to
     * @param amount The amount of tokens to transfer
     */
    function transferFrozen(address from, address to, uint256 amount) external;

    /**
     * @notice Increases the frozen balance for an account
     *
     * Emits a {FrozenBalanceUpdated} event
     *
     * @param account The account to increase frozen balance for
     * @param amount The amount to increase the frozen balance by
     */
    function freezeIncrease(address account, uint256 amount) external;

    /**
     * @notice Decreases the frozen balance for an account
     *
     * Emits a {FrozenBalanceUpdated} event
     *
     * @param account The account to decrease frozen balance for
     * @param amount The amount to decrease the frozen balance by
     */
    function freezeDecrease(address account, uint256 amount) external;

    /**
     * @notice Checks if token freezing is approved for an account
     *
     * @param account The account to check the approval for
     * @return True if token freezing is approved for the account
     */
    function freezeApproval(address account) external view returns (bool);

    /**
     * @notice Retrieves the frozen balance of an account
     *
     * @param account The account to check the balance of
     * @return The amount of tokens that are frozen for the account
     */
    function balanceOfFrozen(address account) external view returns (uint256);
}
