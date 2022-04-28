// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title IRandomProvider interface
 */
interface IRandomProvider {
    function getRandomness() external view returns (uint256);
}
