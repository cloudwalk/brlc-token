// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Freezable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports freezing operations
 */
interface IERC20Freezable {
    /**
     * @notice Emitted when an account is assigned as a freezer
     *
     * @param freezer The address of the assigned freezer
     */
    event FreezerAssigned(address indexed freezer);

    /**
     * @notice Emitted when an account is removed as a freezer
     *
     * @param freezer The address of the removed freezer
     */
    event FreezerRemoved(address indexed freezer);

    /**
     * @notice [DEPRECATED]  Emitted when token freezing has been approved for an account. No longer in use
     * @dev Kept for backward compatibility with transaction analysis tools
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
     * @notice Configures a batch of freezers
     *
     * Emits a {FreezerAssigned} event for each assigned freezer
     *
     * Emits a {FreezerRemoved} event for each removed freezer
     *
     * NOTE: The previous function name was: `configureFreezers()`
     *
     * @param freezers The array of freezer addresses to configure
     * @param status The new status of the freezers: `true` is to assign freezers, `false` is to remove freezers
     */
    function configureFreezerBatch(address[] calldata freezers, bool status) external;

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
     * Emits a {Freeze} event
     *
     * @param account The account to increase frozen balance for
     * @param amount The amount to increase the frozen balance by
     */
    function freezeIncrease(address account, uint256 amount) external;

    /**
     * @notice Decreases the frozen balance for an account
     *
     * Emits a {Freeze} event
     *
     * @param account The account to decrease frozen balance for
     * @param amount The amount to decrease the frozen balance by
     */
    function freezeDecrease(address account, uint256 amount) external;

    /**
     * @notice Checks if the account is configured as a freezer
     *
     * @param account The address to check
     * @return True if the account is configured as a freezer
     */
    function isFreezer(address account) external view returns (bool);

    /**
     * @notice Retrieves the frozen balance of an account
     *
     * @param account The account to check the balance of
     * @return The amount of tokens that are frozen for the account
     */
    function balanceOfFrozen(address account) external view returns (uint256);
}
