// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {RandomableUpgradeable} from "../../base/RandomableUpgradeable.sol";

/**
 * @title RandomableUpgradeableMock contract
 * @dev An implementation of the {RandomableUpgradeable} contract for test purposes.
 */
contract RandomableUpgradeableMock is RandomableUpgradeable {

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __Randomable_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __Randomable_init_unchained();
    }

    /**
     * @dev Cals the appropriate internal function of the {RandomableUpgradeable} contract.
     */
    function getRandomness() external view returns (uint256) {
        return _getRandomness();
    }
}
