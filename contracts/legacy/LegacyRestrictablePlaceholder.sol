// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyRestrictablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Safely replaces the storage of the obsolete basic smart contract `ERC20Restrictable`.
 * @dev This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 *      and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete base smart contract.
 * If it is necessary to use the slots of this smart contract, they must be cleared taking into account the following:
 *
 * - map `_purposeAssignments` must be clear for all addresses for which
 *   the `PurposesAssigned` or `AssignPurposes` events were emitted in the past.
 * - map `_totalRestrictedBalances` must be clear for all addresses for which
 *   the `RestrictionUpdated` or `UpdateRestriction` events were emitted in the past.
 * - map `_restrictedPurposeBalances` must be clear for all addresses and purposes for which
 *   the `RestrictionUpdated` or `UpdateRestriction` events were emitted in the past.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event and error names from this smart-contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyRestrictablePlaceholder {
    /// @notice The mapping of the assigned purposes: account => purposes
    mapping(address => bytes32[]) private _purposeAssignments;

    /// @notice The mapping of the total restricted balances: account => total balance
    mapping(address => uint256) private _totalRestrictedBalances;

    /// @notice The mapping of the restricted purpose balances: account => purpose => balance
    mapping(address => mapping(bytes32 => uint256)) private _restrictedPurposeBalances;

    // -------------------- Events -----------------------------------

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

    // -------------------- Obsolete Events --------------------------

    /**
     * @dev The same as the `PurposesAssigned` event above but with the obsolete name.
     */
    event AssignPurposes(address indexed account, bytes32[] newPurposes, bytes32[] oldPurposes);

    /**
     * @dev The same as the `RestrictionUpdated` event above but with the obsolete name.
     */
    event UpdateRestriction(address indexed account, bytes32 indexed purpose, uint256 newBalance, uint256 oldBalance);

    // -------------------- Errors -----------------------------------

    /// @notice Thrown when the zero restriction purpose is passed to the function
    error ZeroPurpose();

    /// @notice Thrown when the transfer amount exceeds the restricted balance
    error TransferExceededRestrictedAmount();
}
