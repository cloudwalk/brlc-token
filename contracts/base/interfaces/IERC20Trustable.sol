// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title ERC20Trustable contract interface
 * @author CloudWalk Inc.
 * @notice The interface of the token that supports the trusted transfers
 */
interface IERC20Trustable {
    /**
     * @notice Updates the trusted status of the account
     *
     * @param account The address of the account
     * @param status The new trusted status
     */
    function configureTrusted(address account, bool status) external;

    /**
     * @notice Returns the trusted status of the account
     */
    function isTrusted(address account) external view returns(bool);
}