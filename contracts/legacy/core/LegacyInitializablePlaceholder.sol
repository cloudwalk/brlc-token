// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title LegacyInitializablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Safely replaces the storage of the obsolete smart contract `Initializable` from OpenZeppelin lib v4.
 * @dev This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 *      and also contains all of its events for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete library smart contract.
 * If it is necessary to use the slots of this smart contract, they must be cleared, except the `__gap` array.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event names from this smart contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyInitializablePlaceholder {
    /**
     * @dev Indicates that the contract has been initialized.
     * @custom:oz-retyped-from bool
     */
    uint8 internal _initialized;

    /**
     * @dev Indicates that the contract is in the process of being initialized.
     */
    bool private _initializing;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[50] private __gap;

    // -------------------- Events -----------------------------------

    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint8 version);
}
