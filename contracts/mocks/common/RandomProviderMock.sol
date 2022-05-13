// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IRandomProvider} from "../../base/interfaces/IRandomProvider.sol";

contract RandomProviderMock is IRandomProvider {
    uint256 _randomNumber;

    function setRandomNumber(uint256 randomNumber) external {
        _randomNumber = randomNumber;
    }

    function getRandomness() override external view returns (uint256) {
        return _randomNumber;
    }
}
