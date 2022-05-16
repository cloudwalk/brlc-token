// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {FaucetCallerUpgradeable} from "../../base/FaucetCallerUpgradeable.sol";

/**
 * @title FaucetCallerUpgradeableMock contract.
 * @notice For test purpose of the "FaucetCallerUpgradeable" contract.
 */
contract FaucetCallerUpgradeableMock is FaucetCallerUpgradeable {

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize() public {
        __FaucetCaller_init();
    }

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained() public {
        __FaucetCaller_init_unchained();
    }

    function faucetRequest(address recipient) external {
        return _faucetRequest(recipient);
    }
}
