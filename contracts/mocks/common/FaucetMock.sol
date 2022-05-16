// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "../../base/interfaces/IFaucet.sol";

/**
 * @title FaucetMock contract
 * @notice A simple implementation of the {IFaucet} interface for testing purposes
 */
contract FaucetMock is IFaucet {

    /**
     * @notice The address of an account who was a recipient of the last {withdraw} function call
     */
    address public lastWithdrawAddress;

    /**
     * @notice Checks that the contract if an Faucet. Always returns True
     */
    function isFaucet() external override pure returns (bool) {
        return true;
    }

    /**
     * @notice Imitates the withdrawing for an account.
     * Does not really move native tokens, only sets the last recipient
     * @param recipient The address of a recipient to get native tokens from the faucet.
     */
    function withdraw(address payable recipient) external override returns (uint256) {
        lastWithdrawAddress = recipient;
        return 0;
    }
}
