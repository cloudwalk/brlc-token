// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { YieldStreamer } from "../periphery/YieldStreamer.sol";

/**
 * @title YieldStreamerHarness contract
 * @author CloudWalk Inc.
 * @dev The same as {YieldStreamer} but with the new functions of setting internal variables for testing
 */
contract YieldStreamerHarness is YieldStreamer {

    function setLookBackPeriod(uint256 effectiveDay, uint256 length) external onlyOwner {
        emit LookBackPeriodConfigured(effectiveDay, length);
        if (_lookBackPeriods.length == 0) {
            _lookBackPeriods.push(LookBackPeriod({effectiveDay: _toUint16(effectiveDay), length: _toUint16(length)}));
        } else {
            _lookBackPeriods[0].effectiveDay = _toUint16(effectiveDay);
            _lookBackPeriods[0].length = _toUint16(length);
        }
    }

    function resetClaimState(address account) external onlyOwner {
        delete _claims[account];
    }

    function deleteYieldRates() external onlyOwner {
        delete _yieldRates;
    }
}
