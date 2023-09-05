// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BalanceTracker } from "../periphery/BalanceTracker.sol";

/**
 * @title BalanceTrackerHarness contract
 * @author CloudWalk Inc.
 * @notice The same as {BalanceTracker} but with the new functions of setting internal variables for testing
 */
contract BalanceTrackerHarness is BalanceTracker {

    uint256 public currentBlockTimestamp;

    function setInitializationDay(uint16 day) external onlyOwner {
        INITIALIZATION_DAY = day;
    }

    function addBalanceRecord(address account, uint16 day, uint240 value) external onlyOwner {
        _balanceRecords[account].push(Record({day: day, value: value}));
    }

    function setBlockTimestamp(uint256 day, uint256 time) external onlyOwner {
        currentBlockTimestamp = day * (24 * 60 * 60) + time;
    }

    function deleteBalanceRecords(address account) external onlyOwner {
        delete _balanceRecords[account];
    }

    function _blockTimestamp() internal view virtual override returns (uint256) {
        return currentBlockTimestamp;
    }
}
