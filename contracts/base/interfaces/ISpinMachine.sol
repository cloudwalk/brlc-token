// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title ISpinMachine interface
 */
interface ISpinMachine {
    function spin() external returns (bool success, uint256 winnings);
    function canFreeSpin(address account) external view returns(bool);
    function canSpin(address account) external view returns(bool);
}