// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title IFaucet interface
 */
interface IFaucet {
    function isFaucet() external view returns(bool);
    function withdraw(address payable recipient) external returns(uint256);
}