// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { YieldStreamer } from "../periphery/YieldStreamer.sol";

/**
 * @title YieldStreamerHarness contract
 * @author CloudWalk Inc.
 * @dev The same as {YieldStreamer} but with the new functions of setting internal variables for testing
 */
contract YieldStreamerHarness is YieldStreamer {

    function deleteYieldRates() external onlyOwner {
        delete _yieldRates;
    }

    function deleteLookBackPeriods() external onlyOwner {
        delete _lookBackPeriods;
    }

    function resetClaimState(address account) external onlyOwner {
        delete _claims[account];
    }
}
