// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Restrictable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports restriction operations
 */
interface IERC20Restrictable {
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

    /**
     * @notice Assigns the restriction purposes to an account
     *
     * @param account The account to assign purposes to
     * @param purposes The purposes to assign
     */
    function assignPurposes(address account, bytes32[] memory purposes) external;

    /**
     * @notice Returns the restriction purposes assigned to an account
     *
     * @param account The account to fetch the purposes for
     */
    function assignedPurposes(address account) external view returns (bytes32[] memory);

    /**
     * @notice Increases the restriction balance for an account
     *
     * @param account The account to increase restriction for
     * @param purpose The restriction purpose
     * @param amount The amount to increase the restriction balance by
     */
    function restrictionIncrease(address account, bytes32 purpose, uint256 amount) external;

    /**
     * @notice Decreases the restriction balance for an account
     *
     * @param account The account to decrease restriction for
     * @param purpose The restriction purpose
     * @param amount The amount to decrease the restriction balance by
     */
    function restrictionDecrease(address account, bytes32 purpose, uint256 amount) external;

    /**
     * @notice Returns the restricted balance for the account and the restriction purpose
     *
     * @param account The account to get the balance of
     * @param purpose The restriction purpose to check (if zero, returns the total restricted balance)
     */
    function balanceOfRestricted(address account, bytes32 purpose) external view returns (uint256);
}

/**
 * @title IERC20RestrictableV2 interface
 * @dev Interface for ERC20 tokens with restriction capabilities.
 * @notice Provides functions to manage token restrictions and perform restricted transfers.
 */
interface IERC20RestrictableV2 {
    /**
     * @notice Emitted when the restriction is changed for a transfer between accounts.
     *
     * @param from The address from which tokens are being transferred
     * @param to The address to which tokens are being transferred
     * @param id The identifier for the restriction (purpose)
     * @param newBalanceSpecific The new restricted balance for the specific restriction (id)
     * @param oldBalanceSpecific The old restricted balance for the specific restriction (id)
     * @param newBalanceTotal The new total restricted balance
     * @param oldBalanceTotal The old total restricted balance
     */
    event RestrictionChanged(
        address indexed from,
        address indexed to,
        bytes32 indexed id,
        uint256 newBalanceSpecific,
        uint256 oldBalanceSpecific,
        uint256 newBalanceTotal,
        uint256 oldBalanceTotal
    );

    /**
     * @notice Increases the restricted balance for a transfer between accounts.
     *
     * @param from The address from which tokens are being restricted
     * @param to The address to which tokens are being restricted
     * @param amount The amount of tokens to restrict
     * @param id The identifier for the restriction (purpose)
     */
    function restrictionIncrease(address from, address to, uint256 amount, bytes32 id) external;

    /**
     * @notice Decreases the restricted balance for a transfer between accounts.
     *
     * @param from The address from which tokens are being unrestricted
     * @param to The address to which tokens are being unrestricted
     * @param amount The amount of tokens to unrestrict
     * @param id The identifier for the restriction (purpose)
     */
    function restrictionDecrease(address from, address to, uint256 amount, bytes32 id) external;

    /**
     * @notice Transfers tokens with restrictions between accounts.
     *
     * @param from The address from which tokens are being transferred
     * @param to The address to which tokens are being transferred
     * @param amount The amount of tokens to transfer
     * @param id The identifier for the restriction (purpose)
     */
    function transferWithId(address from, address to, uint256 amount, bytes32 id) external;

    /**
     * @notice Returns the restricted balance for a transfer between accounts for a specific restriction.
     *
     * @param from The address from which tokens are being restricted
     * @param to The address to which tokens are being restricted
     * @param id The identifier for the restriction (purpose)
     * @return The amount of restricted tokens
     */
    function balanceOfRestricted(address from, address to, bytes32 id) external view returns (uint256);
}
