// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IRandomProvider} from "../../base/interfaces/IRandomProvider.sol";

/**
 * @title RandomProviderMock contract
 * @notice A simple implementation of the {IRandomProvider} interface for testing purposes.
 */
contract RandomProviderMock is IRandomProvider {
    uint256 private _randomNumber;

    /**
     * @notice Sets a new random number to return by the subsequent calls of function {getRandomness}.
     * @param randomNumber The new random number to set.
     */
    function setRandomNumber(uint256 randomNumber) external {
        _randomNumber = randomNumber;
    }

    /**
     * @notice Returns the previously set random number.
     */
    function getRandomness() override external view returns (uint256) {
        return _randomNumber;
    }
}
