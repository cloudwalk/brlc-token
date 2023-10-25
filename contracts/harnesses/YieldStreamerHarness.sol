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

    function deleteYieldRates() external onlyHarnessAdmin {
        delete _yieldRates;
    }

    function deleteLookBackPeriods() external onlyHarnessAdmin {
        delete _lookBackPeriods;
    }

    function resetClaimState(address account) external onlyHarnessAdmin {
        delete _claims[account];
    }

    function setClaimState(address account, uint16 day, uint240 debit) external onlyHarnessAdmin {
        ClaimState storage claim = _claims[account];
        claim.day = day;
        claim.debit = debit;
    }
}
