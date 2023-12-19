// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IBalanceTracker } from "./../base/interfaces/periphery/IBalanceTracker.sol";

/**
 * @title BalanceTrackerMock contract
 * @author CloudWalk Inc.
 * @notice A simplified implementation of the {BalanceTracker} contract for testing the YieldStreamer contract
 */
contract BalanceTrackerMock is IBalanceTracker {
    struct BalanceRecord {
        uint16 day;
        uint240 value;
    }

    address internal _token;
    uint256 internal _day;
    uint256 internal _time;
    uint256 internal _initDay;
    mapping(address => BalanceRecord[]) public _balanceRecords;
    mapping(address => uint256) public _currentBalances;

    constructor(address token_) {
        _token = token_;
    }

    function setInitDay(uint256 initDay_) external {
        _initDay = initDay_;
    }

    function setDayAndTime(uint256 day_, uint256 time_) external {
        _day = day_;
        _time = time_;
    }

    function setBalanceRecords(address account, BalanceRecord[] calldata records) external {
        delete _balanceRecords[account];
        uint256 len = records.length;
        for (uint256 i = 0; i < len; ++i) {
            _balanceRecords[account].push(records[i]);
        }
    }

    function setCurrentBalance(address account, uint256 value) external {
        _currentBalances[account] = value;
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function getDailyBalances(
        address account,
        uint256 fromDay,
        uint256 toDay
    ) external view returns (uint256[] memory) {
        uint16 dayOfBalanceChange;
        uint256 balance;
        uint256 recordIndex = _balanceRecords[account].length;
        if (fromDay < _initDay) {
            revert("BalanceTrackerMock: the 'from' day is prior the init day");
        }
        if (fromDay > toDay) {
            revert("BalanceTrackerMock: the 'to' day is prior the 'from' day");
        }
        if (recordIndex == 0) {
            revert("BalanceTrackerMock: balance records does not set for the account");
        } else if (toDay >= _balanceRecords[account][--recordIndex].day) {
            balance = _currentBalances[account];
            dayOfBalanceChange = _balanceRecords[account][recordIndex].day;
        } else {
            while (_balanceRecords[account][--recordIndex].day > toDay) {}
            balance = _balanceRecords[account][recordIndex + 1].value;
            dayOfBalanceChange = _balanceRecords[account][recordIndex].day;
        }

        uint256 i = toDay + 1 - fromDay;
        uint256 day = fromDay + i;
        uint256[] memory balances = new uint256[](i);
        do {
            i--;
            day--;
            if (day == dayOfBalanceChange) {
                balance = _balanceRecords[account][recordIndex].value;
                if (recordIndex != 0) {
                    dayOfBalanceChange = _balanceRecords[account][--recordIndex].day;
                }
            }
            balances[i] = balance;
        } while (i > 0);

        return balances;
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function dayAndTime() public view returns (uint256, uint256) {
        return (_day, _time);
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function token() external view returns (address) {
        return _token;
    }
}
