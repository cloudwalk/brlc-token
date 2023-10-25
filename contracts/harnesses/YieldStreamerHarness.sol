// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { YieldStreamer } from "../periphery/YieldStreamer.sol";
import { HarnessAdministrable } from "./HarnessAdministrable.sol";

/**
 * @title YieldStreamerHarness contract
 * @author CloudWalk Inc.
 * @dev The same as {YieldStreamer} but with the new functions of setting internal variables for testing
 */
contract YieldStreamerHarness is YieldStreamer, HarnessAdministrable {
    /**
     * @notice Deletes all records from the yield rate chronological array
     */
    function deleteYieldRates() external onlyHarnessAdmin {
        delete _yieldRates;
    }

    /**
     * @notice Deletes all records from the look-back period chronological array
     */
    function deleteLookBackPeriods() external onlyHarnessAdmin {
        delete _lookBackPeriods;
    }

    /**
     * @notice Resets the claim state to default values for an account
     *
     * @param account The address of the account to reset the claim state
     */
    function resetClaimState(address account) external onlyHarnessAdmin {
        delete _claims[account];
    }

    /**
     * @notice Sets the claim state for an account
     *
     * @param account The address of the account to set the claim state
     * @param day The day to set in the claim state of the account
     * @param debit The debit to set in the claim state of the account
     */
    function setClaimState(address account, uint16 day, uint240 debit) external onlyHarnessAdmin {
        ClaimState storage claim = _claims[account];
        claim.day = day;
        claim.debit = debit;
    }
}
