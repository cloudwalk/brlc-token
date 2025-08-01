// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyBlocklistablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Safely replaces the storage of the obsolete basic account blocklisting smart contract.
 *
 * This contract is used through inheritance. It has the same storage as the smart contract it replaces,
 * and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete base smart contract.
 * If it is necessary to use the slots of this smart contract, they must be cleared taking into account the following:
 *
 * - map `_blocklisted` must be clear for all addresses for which
 *   the `Blocklisted` and `Blacklisted` events were emitted in the past.
 * - map `BlocklistableStorageSlot.blocklisters` must be clear for all addresses for which
 *   the `BlocklisterConfigured` and `BlacklisterConfigured` events were emitted in the past.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event and error names from this smart-contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyBlocklistablePlaceholder {
    // ------------------ Namespaced storage layout --------------- //

    /// @dev The storage slot where additional blocklistable contract storage starts.
    bytes32 private constant _BLOCKLISTABLE_STORAGE_SLOT =
        0xff11fdfa16fed3260ed0e7147f7cc6da11a60208b5b9406d12a635614ffd9141;

    /**
     * @dev Defines the additional storage of the Blocklistable base contract.
     *
     * Fields:
     *
     * - blocklisters -- The mapping of presence in the blocklist for a given address.
     * - enabled ------- The enabled/disabled status of the blocklist.
     *
     */
    struct BlocklistableStorageSlot {
        // Slot 1
        mapping(address => bool) blocklisters;
        // No reserve until the end of the storage slot

        // Slot 2
        bool enabled;
        // uint248 __reserved1; // Reserved until the end of the storage slot
    }

    // ------------------ Storage variables ----------------------- //

    /// @dev The address of the blocklister that is allowed to add and remove accounts from the blocklist.
    address private _mainBlocklister;

    /// @dev Mapping of presence in the blocklist for a given address.
    mapping(address => bool) private _blocklisted;

    // -------------------- Events -------------------------------- //

    /**
     * @dev Emitted when an account is blocklisted.
     * @param account The address of the blocklisted account.
     */
    event Blocklisted(address indexed account);

    /**
     * @dev Emitted when an account is unblocklisted.
     * @param account The address of the unblocklisted account.
     */
    event UnBlocklisted(address indexed account);

    /**
     * @dev Emitted when an account is self blocklisted.
     * @param account The address of the self blocklisted account.
     */
    event SelfBlocklisted(address indexed account);

    /**
     * @dev Emitted when the main blocklister was changed.
     * @param newMainBlocklister The address of the new main blocklister.
     */
    event MainBlockListerChanged(address indexed newMainBlocklister);

    /**
     * @dev Emitted when the blocklister configuration is updated.
     * @param blocklister The address of the blocklister.
     * @param status The new status of the blocklister.
     */
    event BlocklisterConfigured(address indexed blocklister, bool status);

    /**
     * @dev Emitted when the blocklist is enabled or disabled.
     * @param status The new enabled/disabled status of the blocklist.
     */
    event BlocklistEnabled(bool indexed status);

    // -------------------- Obsolete Events ----------------------- //

    /**
     * @dev The same as the `Blocklisted` event above but with the obsolete name.
     */
    event Blacklisted(address indexed account);

    /**
     * @dev The same as the `UnBlocklisted` event above but with the obsolete name.
     */
    event UnBlacklisted(address indexed account);

    /**
     * @dev The same as the `SelfBlocklisted` event above but with the obsolete name.
     */
    event SelfBlacklisted(address indexed account);

    /**
     * @dev The same as the `MainBlockListerChanged` event above but with the obsolete name.
     */
    event MainBlackListerChanged(address indexed newMainBlacklister);

    /**
     * @dev The same as the `BlocklisterConfigured` event above but with the obsolete name.
     */
    event BlacklisterConfigured(address indexed blacklister, bool status);

    /**
     * @dev The same as the `BlocklisterConfigured` event above but with the obsolete name.
     */
    event BlacklistEnabled(bool indexed status);

    // -------------------- Errors -------------------------------- //

    /**
     * @dev The transaction sender is not a blocklister.
     * @param account The address of the transaction sender.
     */
    error UnauthorizedBlocklister(address account);

    /**
     * @dev The transaction sender is not a main blocklister.
     * @param account The address of the transaction sender.
     */
    error UnauthorizedMainBlocklister(address account);

    /**
     * @dev The account is blocklisted.
     * @param account The address of the blocklisted account.
     */
    error BlocklistedAccount(address account);

    /**
     * @dev The address to blocklist is zero address.
     */
    error ZeroAddressToBlocklist();

    /**
     * @dev The account is already configured.
     */
    error AlreadyConfigured();
}
