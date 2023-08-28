// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IBalanceTracker interface
 * @author CloudWalk Inc.
 * @notice The interface of a contract that tracks daily token balances
 */
interface IBalanceTracker {
    /**
     * @notice Returns the daily account balances for the specified period range
     *
     * @param account The account to get the balances for
     * @param from The start day of the period range
     * @param to The end day of the period range
     */
    function getDailyBalances(address account, uint256 from, uint256 to) external view returns (uint256[] memory);

    /**
     * @notice Returns the balance tracker current day index and time
     */
    function dayAndTime() external view returns (uint256, uint256);

    /**
     * @notice Returns the address of the hooked token contract
     */
    function token() external view returns (address);
}
