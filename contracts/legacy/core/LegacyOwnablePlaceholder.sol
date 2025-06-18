// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title LegacyOwnablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Safely replaces the storage of the obsolete smart contract `OwnableUpgradeable` from OpenZeppelin lib v4.
 *
 * This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 * and also contains all of its events for backward compatibility when searching in databases.
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
abstract contract LegacyOwnablePlaceholder {
    // ------------------ Storage variables ----------------------- //

    /// @dev The owner of the smart contract.
    address internal _owner;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[49] private __gap;

    // -------------------- Events -------------------------------- //

    /**
     * @dev Emitted when the owner of this contract has been changed.
     * @param previousOwner The address of the previous owner of this contract.
     * @param newOwner The address of the new owner of this contract.
     */
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
