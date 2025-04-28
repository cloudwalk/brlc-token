// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyRescuablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Safely replaces the storage of the obsolete basic smart contract `RescuableUpgradeable`.
 * @dev This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 *      and also contains all of its events and custom errors for backward compatibility when searching in databases.
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
abstract contract LegacyRescuablePlaceholder {
    // ------------------ Storage variables ----------------------- //

    /// @notice The address of the rescuer that is allowed to rescue tokens locked up in the contract
    address internal _rescuer;

    // -------------------- Events -------------------------------- //

    /**
     * @notice Emitted when the rescuer is changed
     *
     * @param newRescuer The address of the new rescuer
     */
    event RescuerChanged(address indexed newRescuer);

    // -------------------- Errors -------------------------------- //

    /**
     * @notice The transaction sender is not a rescuer
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedRescuer(address account);
}
