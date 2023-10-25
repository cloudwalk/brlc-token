// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BalanceTracker } from "../periphery/BalanceTracker.sol";
import { HarnessAdministrable } from "./HarnessAdministrable.sol";

/**
 * @title BalanceTrackerHarness contract
 * @author CloudWalk Inc.
 * @notice The same as {BalanceTracker} but with the new functions of setting internal variables for testing
 */
contract BalanceTrackerHarness is BalanceTracker, HarnessAdministrable {
    /// @notice The structure with the contract state
    struct BalanceTrackerHarnessState {
        uint256 currentBlockTimestamp;
        bool usingRealBlockTimestamps;
    }

    /// @notice The memory slot used to store the contract state
    /// @dev It is the same as keccak256("balance tracker harness storage slot")
    bytes32 private constant _STORAGE_SLOT = 0xceb91ca8f20e7d3bc24614515796ccaa88bb45ed0206676ef6d6620478090c43;

    function setInitializationDay(uint16 day) external onlyHarnessAdmin {
        INITIALIZATION_DAY = day;
    }

    function addBalanceRecord(address account, uint16 day, uint240 value) external onlyHarnessAdmin {
        _balanceRecords[account].push(Record({ day: day, value: value }));
    }

    function setBlockTimestamp(uint256 day, uint256 time) external onlyHarnessAdmin {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.currentBlockTimestamp = day * (24 * 60 * 60) + time;
    }

    function setUsingRealBlockTimestamps(bool newValue) external onlyHarnessAdmin {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.usingRealBlockTimestamps = newValue;
    }

    function deleteBalanceRecords(address account) external onlyHarnessAdmin {
        delete _balanceRecords[account];
    }

    function _blockTimestamp() internal view virtual override returns (uint256) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        if (state.usingRealBlockTimestamps) {
            return super._blockTimestamp();
        } else {
            uint256 blockTimestamp = state.currentBlockTimestamp;
            if (blockTimestamp < NEGATIVE_TIME_SHIFT) {
                return 0;
            } else {
                return blockTimestamp - NEGATIVE_TIME_SHIFT;
            }
        }
    }

    /**
     * @notice Returns the contract stored state structure
     */
    function _getBalanceTrackerHarnessState() internal pure returns (BalanceTrackerHarnessState storage) {
        BalanceTrackerHarnessState storage state;
        /// @solidity memory-safe-assembly
        assembly {
            state.slot := _STORAGE_SLOT
        }
        return state;
    }
}
