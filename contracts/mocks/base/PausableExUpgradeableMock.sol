// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {PausableExUpgradeable} from "../../base/PausableExUpgradeable.sol";

/**
 * @title PausableExUpgradeableMock contract
 * @dev An implementation of the {PausableExUpgradeable} contract for test perposes.
 */
contract PausableExUpgradeableMock is PausableExUpgradeable {

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __PausableEx_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __PausableEx_init_unchained();
    }
}
