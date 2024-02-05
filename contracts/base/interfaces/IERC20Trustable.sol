// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title ERC20Trustable contract interface
 * @author CloudWalk Inc.
 * @notice The interface of the token that supports the `trusted` transfers on behalf
 */
interface IERC20Trustable {
    /**
     * @notice Emitted when the `trusted` status of the account is configured
     *
     * @param account The address of the account that is configured
     * @param status The new `trusted` status of the account
     */
    event TrustedAccountConfigured(address indexed account, bool status);

    /**
     * @notice Updates the `trusted` status of the account
     *
     * @param account The address of the account to be configured
     * @param status The new `trusted` status of the account
     */
    function configureTrustedAccount(address account, bool status) external;

    /**
     * @notice Returns the `trusted` status of the account
     */
    function isTrustedAccount(address account) external view returns(bool);
}
