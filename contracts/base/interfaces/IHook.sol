// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IHook interface
 * @author CloudWalk Inc.
 * @notice The interface of a contract that supports hookable token operations
 */
interface IHook {
    /**
     * @notice Hook function that is called by the token contract before token transfer
     * @param from The address that tokens will be transferred from
     * @param to The address that tokens will be transferred to
     * @param amount The amount of tokens to be transferred
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external;

    /**
     * @notice Hook function that is called by the token contract after token transfer
     * @param from The address that tokens have been transferred from
     * @param to The address that tokens have been transferred to
     * @param amount The amount of tokens transferred
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external;
}
