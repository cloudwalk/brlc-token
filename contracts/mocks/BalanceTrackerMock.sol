// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IBalanceTracker } from "./../base/interfaces/periphery/IBalanceTracker.sol";

/**
 * @title BalanceTrackerMock contract
 * @author CloudWalk Inc.
 * @notice A simplified implementation of the {BalanceTracker} contract for testing the YieldStreamer contract
 */
contract BalanceTrackerMock is IBalanceTracker {

    enum BalanceStatus {
        Nonexistent,
        Configured
    }

    struct BalanceState {
        BalanceStatus status;
        uint248 value;
    }

    struct BalanceConfig {
        uint16 day;
        uint240 value;
    }

    address internal _token;
    uint256 internal _day;
    uint256 internal _time;
    mapping(address => mapping(uint256 => BalanceState)) internal _balanceStates;

    error BalanceNotConfigured(uint256 day);

    constructor(address token_) {
        _token = token_;
    }

    function setDailyBalances(address account, BalanceConfig[] calldata balanceConfigs) external {
        uint256 len = balanceConfigs.length;
        for (uint256 i = 0; i < len; ++i) {
            BalanceConfig calldata balanceConfig = balanceConfigs[i];
            BalanceState memory balanceState = BalanceState({
                status: BalanceStatus.Configured,
                value: balanceConfig.value
            });
            _balanceStates[account][balanceConfig.day] = balanceState;
        }
    }

    function setDayAndTime(uint256 day_, uint256 time_) external {
        _day = day_;
        _time = time_;
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function getDailyBalances(
        address account,
        uint256 fromDay,
        uint256 toDay
    ) external view returns (uint256[] memory) {
        uint256 len = toDay + 1 - fromDay;
        uint256[] memory balances = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            BalanceState memory balanceState = _balanceStates[account][fromDay + i];
            if (balanceState.status != BalanceStatus.Configured) {
                revert BalanceNotConfigured(fromDay + i);
            }
        }
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
