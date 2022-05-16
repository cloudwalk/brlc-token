// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {FaucetCallerUpgradeable} from "../../base/FaucetCallerUpgradeable.sol";

/**
 * @title FaucetCallerUpgradeableMock contract
 * @notice An implementation of the {FaucetCallerUpgradeable} contract for test purposes.
 */
contract FaucetCallerUpgradeableMock is FaucetCallerUpgradeable {

    /**
     * @notice The initialize function of the upgradable contract
     * But without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __FaucetCaller_init();
    }

    /**
     * @notice The unchained initialize function of the upgradable contract
     * But without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __FaucetCaller_init_unchained();
    }

    /**
     * @notice Cals the appropriate internal function of the {FaucetCallerUpgradeable} contract.
     * @param recipient The address of a recipient of the gotten from a faucet native tokens.
     */
    function faucetRequest(address recipient) external {
        return _faucetRequest(recipient);
    }
}
