// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyTrustablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Safely replaces the storage of the obsolete basic smart contract `ERC20Trustable`.
 * @dev This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 *      and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete base smart contract.
 * If it is necessary to use the slots of this smart contract, they must be cleared taking into account the following:
 *
 * - map `_trusted` must be clear for all addresses for which
 *   the `TrustedAccountConfigured` events were emitted in the past.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event and error names from this smart-contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyTrustablePlaceholder {
    // ------------------ Storage variables ----------------------- //

    /// @notice The mapping of the configured `trusted` status of the accounts
    mapping(address => bool) private _trusted;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[49] private __gap;

    // -------------------- Events -------------------------------- //

    /**
     * @notice Emitted when the `trusted` status of the account is configured
     *
     * @param account The address of the account that is configured
     * @param status The new `trusted` status of the account
     */
    event TrustedAccountConfigured(address indexed account, bool status);

    // -------------------- Errors -------------------------------- //

    /// @notice Thrown when the account is already configured with the same `trusted` status
    error TrustedAccountAlreadyConfigured();
}
