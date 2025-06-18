// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyPausablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Safely replaces the storage of the obsolete basic smart contract `PausableExtUpgradeable`.
 *
 * This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 * and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete library smart contract.
 * If it is necessary to use the slots of this smart contract, they must be cleared, except the `__gap` array.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event and error names from this smart-contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyPausablePlaceholder {
    // ------------------ Storage variables ----------------------- //

    /// @dev The paused state of the contract.
    bool private _paused;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[49] private __gap;

    /// @dev The address of the pauser that is allowed to trigger the paused or unpaused state of the contract.
    address internal _pauser;

    // -------------------- Events -------------------------------- //

    /**
     * @dev Emitted when the pauser is changed.
     * @param pauser The address of the new pauser.
     */
    event PauserChanged(address indexed pauser);

    // -------------------- Errors -------------------------------- //

    /**
     * @dev The transaction sender is not a pauser.
     * @param account The address of the transaction sender.
     */
    error UnauthorizedPauser(address account);
}
