// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Referenceable
 * @author CloudWalk Inc.
 * @notice This interface defines methods for creating and managing referenced token transfers.
 */
interface IERC20Referenceable {
    /**
     * @notice Emitted when a reference is created
     * @param id The unique identifier of the reference
     * @param sender The address initiating the reference creation
     * @param amount The amount of tokens associated with the reference
     */
    event ReferenceCreated(bytes32 indexed id, address indexed sender, uint256 amount);

    /**
     * @notice Emitted when a reference is updated
     * @param id The unique identifier of the reference
     * @param newAmount The new amount of tokens associated with the reference
     * @param oldAmount The old amount of tokens associated with the reference
     */
    event ReferenceUpdated(bytes32 indexed id, uint256 newAmount, uint256 oldAmount);

    /**
     * @notice Emitted when tokens are transferred using a reference
     * @param id The unique identifier of the reference used for the transfer
     * @param sender The address initiating the transfer
     * @param receiver The address receiving the tokens
     * @param amount The amount of tokens transferred
     */
    event TransferWithId(bytes32 indexed id, address indexed sender, address indexed receiver, uint256 amount);

    /**
    * @notice Emitted when the reference admin status is configured
    *
    * @param account The account of the reference admin
    * @param status The new status of the reference admin
    */
    event ReferenceAdminConfigured(address account, bool status);


    /**
     * @notice Configures the account with the passed reference admin status
     *
     * Emits a {ReferenceAdminConfigured} event
     *
     * @param account The account to configure
     * @param status The new status of the account
     */
    function configureReferenceAdmin(address account, bool status) external;

    /**
     * @notice Creates a new reference for a specified amount of tokens
     * @param id The unique identifier of the reference
     * @param account The address for which the tokens are being referenced
     * @param amount The amount of tokens to reference
     */
    function createReference(bytes32 id, address account, uint256 amount) external;

    /**
     * @notice Updates an existing reference with a new amount of tokens
     * @param id The unique identifier of the reference to update
     * @param account The address associated with the reference
     * @param newAmount The new amount of tokens to reference
     */
    function updateReference(bytes32 id, address account, uint256 newAmount) external;

    /**
     * @notice Transfers tokens using a specified reference ID
     * @param sender The address initiating the transfer
     * @param receiver The address receiving the tokens
     * @param amount The amount of tokens to transfer
     * @param id The unique identifier of the reference used for the transfer
     */
    function transferFromWithId(address sender, address receiver, uint256 amount, bytes32 id) external;

    /**
     * @notice Retrieves the amount of tokens referenced for a specific account and reference ID
     * @param account The address associated with the reference
     * @param id The unique identifier of the reference
     * @return The amount of tokens referenced
     */
    function getAccountReferencesById(address account, bytes32 id) external view returns (uint256);

    /**
     * @notice Retrieves the total balance of tokens referenced for a specific account
     * @param account The address associated with the references
     * @return The total balance of tokens referenced
     */
    function balanceOfReferenced(address account) external view returns (uint256);
}
