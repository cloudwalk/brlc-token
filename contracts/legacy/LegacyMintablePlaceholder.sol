// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title LegacyMintablePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Safely replaces the obsolete part of the basic smart contract `ERC20Mintable`.
 * @dev This contract is used through inheritance. It has the same storage as the smart contract part it replaces,
 *      and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * IMPORTANT! The storage slots of this smart contract are not empty and may contain data
 * from the obsolete base smart contract part.
 * If it is necessary to use the slots of this smart contract, they must be cleared taking into account the following:
 *
 * - map `_minters` must be clear for all addresses for which
 *   the `MinterConfigured` or `MainMinterChanged` or `MasterMinterChanged` events were emitted in the past.
 * - map `_mintersAllowance` must be clear for all addresses for which
 *   the `MinterConfigured` or `MainMinterChanged` or `MasterMinterChanged` events were emitted in the past.
 *
 * RECOMMENDATIONS!
 * 1. It is better not to use the event and error names from this smart-contract
 *    to avoid confusion between legacy and new entities.
 * 2. This contract should be removed for new deployments.
 */
abstract contract LegacyMintablePlaceholder {
    // ------------------ Storage variables ----------------------- //

    /// @notice The address of the main minter
    address private _mainMinter;

    /// @notice The mapping of the configured minters
    mapping(address => bool) private _minters;

    /// @notice The mapping of the configured mint allowances
    mapping(address => uint256) private _mintersAllowance;

    // -------------------- Events -------------------------------- //

    /**
     * @notice Emitted when the main minter is changed
     *
     * @param newMainMinter The address of a new main minter
     */
    event MainMinterChanged(address indexed newMainMinter);

    /**
     * @notice Emitted when a minter account is configured
     *
     * @param minter The address of the minter to configure
     * @param mintAllowance The mint allowance
     */
    event MinterConfigured(address indexed minter, uint256 mintAllowance);

    /**
     * @notice Emitted when a minter account is removed
     *
     * @param oldMinter The address of the minter to remove
     */
    event MinterRemoved(address indexed oldMinter);

    // -------------------- Obsolete Events ----------------------- //

    /**
     * @notice Emitted when the master minter is changed
     *
     * @param newMasterMinter The address of a new master minter
     */
    event MasterMinterChanged(address indexed newMasterMinter);

    // -------------------- Errors -------------------------------- //

    /**
     * @notice The transaction sender is not a main minter
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMainMinter(address account);

    /**
     * @notice The transaction sender is not a minter
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMinter(address account);

    /// @notice The mint allowance is exceeded during the mint operation
    error ExceededMintAllowance();

    // -------------------- Obsolete Errors ----------------------- //

    /**
     * @notice The transaction sender is not a master minter
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMasterMinter(address account);
}
