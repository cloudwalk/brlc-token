// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Restrictable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports restriction operations
 */
interface IERC20Restrictable {
    /**
     * @notice Emitted when tokens are transferred with the restriction purpose
     *
     * @param from The address of the account tokens are transferred from
     * @param to The address of the account tokens are transferred to
     * @param amount The amount of tokens transferred
     * @param purpose The restriction purpose
     */
    event TransferWithPurpose(address from, address to, uint256 amount, bytes32 purpose);

    /**
     * @notice Emitted when the restriction purposes are assigned to the account
     *
     * @param account The address of the account the restriction purposes are assigned to
     * @param newPurposes The array of the new restriction purposes
     * @param oldPurposes The array of the old restriction purposes
     */
    event AssignPurposes(address indexed account, bytes32[] newPurposes, bytes32[] oldPurposes);

    /**
     * @notice Emitted when the restriction is removed from the account
     *
     * @param account The address of the account the restriction is removed from
     * @param amount The amount of tokens the restriction is removed from
     * @param purpose The restriction purpose
     */
    event RemoveRestriction(address indexed account, uint256 amount, bytes32 purpose);

    /**
     * @notice Assigns the restriction purposes to the account
     *
     * @param account The address of the account to assign purposes to
     * @param purposes The purposes to assign
     */
    function assignPurposes(address account, bytes32[] memory purposes) external;


    /**
     * @notice Removes the restriction from the account for the purpose and amount
     *
     * @param account The address of the account to remove restriction from
     * @param amount The amount of tokens to remove restriction from
     * @param purpose The restriction purpose
     */
    function removeRestriction(address account, uint256 amount, bytes32 purpose) external;

    /**
     * @notice Transfers the amount of tokens to the recipient with the restriction purpose
     *
     * @param to The address of the account to transfer tokens to
     * @param amount The amount of tokens to transfer
     * @param purpose The restriction purpose
     */
    function transferWithPurpose(address to, uint256 amount, bytes32 purpose) external returns (bool);

    /**
     * @notice Returns the restricted account balance for a specific purpose
     *
     * @param account The address of the account to check
     * @param purpose The restriction purpose to check
     */
    function balanceOfRestricted(address account, bytes32 purpose) external view returns (uint256);

    /**
     * @notice Returns the total restricted balance for the account
     *
     * @param account The address of the account to check
     */
    function balanceOfRestricted(address account) external view returns (uint256);
}
