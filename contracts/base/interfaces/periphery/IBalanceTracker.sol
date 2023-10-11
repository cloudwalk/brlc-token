// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IBalanceTracker interface
 * @author CloudWalk Inc.
 * @notice The interface of a contract that tracks daily token balances
 */
interface IBalanceTracker {
    /**
     * @notice Returns the daily balances for the specified account and period
     *
     * @param account The address of the account to get the balances for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     */
    function getDailyBalances(address account, uint256 fromDay, uint256 toDay) external view returns (uint256[] memory);

    /**
     * @notice Returns the balance tracker current day index and time
     */
    function dayAndTime() external view returns (uint256, uint256);

    /**
     * @notice Returns the address of the hooked token contract
     */
    function token() external view returns (address);
}
