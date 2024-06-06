// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Restrictable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports restriction operations
 */
interface IERC20Restrictable {
    /**
     * @notice Emitted when a restriction is changed internally or externally
     *
     * @param from TODO
     * @param to TODO
     * @param id TODO
     * @param newBalanceSpecific TODO
     * @param oldBalanceSpecific TODO
     * @param newBalanceTotal TODO
     * @param oldBalanceTotal TODO
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
     * @param id TODO
     */
    function balanceOfRestricted(address account, bytes32 id) external view returns (uint256);
}
