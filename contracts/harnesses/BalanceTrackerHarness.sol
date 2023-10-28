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

    /**
     * @notice Sets the initialization day of the balance tracker
     *
     * @param day The new initialization day to set
     */
    function setInitializationDay(uint16 day) external onlyOwner {
        INITIALIZATION_DAY = day;
    }

    /**
     * @notice Adds a new balance record to the chronological array of an account
     *
     * @param account The address of the account to add the balance record for
     * @param day The creation day of the new record
     * @param value The value of the new record
     */
    function addBalanceRecord(address account, uint16 day, uint240 value) external onlyHarnessAdmin {
        _balanceRecords[account].push(Record({ day: day, value: value }));
    }

    /**
     * @notice Sets the balance record chronological array for an account according to provided array
     *
     * @param account The address of the account to set the balance record array for
     * @param balanceRecords The array of new records to set
     */
    function setBalanceRecords(address account, Record[] calldata balanceRecords) external onlyHarnessAdmin {
        delete _balanceRecords[account];
        uint256 len = balanceRecords.length;
        for (uint256 i = 0; i < len; ++i) {
            _balanceRecords[account].push(balanceRecords[i]);
        }
    }

    /**
     * @notice Sets the current block time that should be used by the contract in certain conditions
     *
     * @param day The new day index starting from the Unix epoch to set
     * @param time The new time in seconds starting from the beginning of the day to set
     */
    function setBlockTimestamp(uint256 day, uint256 time) external onlyHarnessAdmin {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.currentBlockTimestamp = day * (24 * 60 * 60) + time;
    }

    /**
     * @notice Sets the boolean variable that defines whether the real block time is used in the contract
     *
     * @param newValue The new value. If true the real block time is used. Otherwise previously set time is used
     */
    function setUsingRealBlockTimestamps(bool newValue) external onlyOwner {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.usingRealBlockTimestamps = newValue;
    }

    /**
     * @notice Deletes all records from the balance record chronological array for an account
     *
     * @param account The address of the account to clear the balance record array for
     */
    function deleteBalanceRecords(address account) external onlyHarnessAdmin {
        delete _balanceRecords[account];
    }

    /**
     * @notice Returns the boolean value that defines whether the real block time is used in the contract or not
     */
    function getUsingRealBlockTimestamps() external view returns (bool) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        return state.usingRealBlockTimestamps;
    }

    /**
     * @notice Returns the internal state variable that defines the block timestamp if real time is not used
     */
    function getCurrentBlockTimestamp() external view returns (uint256) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        return state.currentBlockTimestamp;
    }

    /// @notice Returns the block timestamp according to the contract settings: the real time or a previously set time
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
