// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import "../../base/interfaces/IFaucet.sol";

contract FaucetMock is IFaucet {

    address public lastWithdrawAddress;

    function isFaucet() external override pure returns (bool) {
        return true;
    }

    function withdraw(address payable recipient) external override returns (uint256) {
        lastWithdrawAddress = recipient;
        return 0;
    }
}
