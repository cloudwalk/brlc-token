// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Hook interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of a contract that supports hookable token operations.
 */
interface IERC20Hook {
    /**
     * @dev Hook function that is called by a token contract before token transfer.
     * @param from The address that tokens will be transferred from.
     * @param to The address that tokens will be transferred to.
     * @param amount The amount of tokens to be transferred.
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external;

    /**
     * @dev Hook function that is called by a token contract after token transfer.
     * @param from The address that tokens have been transferred from.
     * @param to The address that tokens have been transferred to.
     * @param amount The amount of tokens transferred.
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external;
}
