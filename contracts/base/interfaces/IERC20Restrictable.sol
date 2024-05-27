// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Restrictable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports restriction operations
 */
interface IERC20Restrictable {
    /**
     * @notice Emitted when the restriction purposes are assigned to an account
     *
     * @param account The account the restriction purposes are assigned to
     * @param newPurposes The array of the new restriction purposes
     * @param oldPurposes The array of the old restriction purposes
     */
    event PurposesAssigned(address indexed account, bytes32[] newPurposes, bytes32[] oldPurposes);

    /**
     * @notice Emitted when the restriction is updated for an account
     *
     * @param account The account the restriction is updated for
     * @param purpose The restriction purpose
     * @param newBalance The new restricted balance
     * @param oldBalance The old restricted balance
     */
    event RestrictionUpdated(address indexed account, bytes32 indexed purpose, uint256 newBalance, uint256 oldBalance);

    /**
    * @notice Emitted when the restricter status is configured
    *
    * @param account The account of restricter
    * @param status The new status of the restricter
    */
    event RestricterConfigured(address indexed account, bool status);

    /**
     * @notice Configures the account with the passed restricter status
     *
     * Emits a {RestricterConfigured} event
     *
     * @param account The account to configure
     * @param status The new status of the account
     */
    function configureRestricter(address account, bool status) external;

    /**
     * @notice Assigns the restriction purposes to an account
     *
     * @param account The account to assign purposes to
     * @param purposes The purposes to assign
     */
    function assignPurposes(address account, bytes32[] memory purposes) external;

    /**
     * @notice Returns the restriction purposes assigned to an account
     *
     * @param account The account to fetch the purposes for
     */
    function assignedPurposes(address account) external view returns (bytes32[] memory);

    /**
     * @notice Increases the restriction balance for an account
     *
     * @param account The account to increase restriction for
     * @param purpose The restriction purpose
     * @param amount The amount to increase the restriction balance by
     */
    function restrictionIncrease(address account, bytes32 purpose, uint256 amount) external;

    /**
     * @notice Decreases the restriction balance for an account
     *
     * @param account The account to decrease restriction for
     * @param purpose The restriction purpose
     * @param amount The amount to decrease the restriction balance by
     */
    function restrictionDecrease(address account, bytes32 purpose, uint256 amount) external;

    /**
     * @notice Checks if the account is a configured restricter
     *
     * @param account The account to check the restricter status of
     * @return True if account is configured as a restricter
     */
    function isRestricter(address account) external view returns (bool);

    /**
     * @notice Returns the restricted balance for the account and the restriction purpose
     *
     * @param account The account to get the balance of
     * @param purpose The restriction purpose to check (if zero, returns the total restricted balance)
     */
    function balanceOfRestricted(address account, bytes32 purpose) external view returns (uint256);
}
