// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableExUpgradeable} from "../../base/WhitelistableExUpgradeable.sol";

/**
 * @title WhitelistableExUpgradeableMock contract
 * @dev An implementation of the {WhitelistableExUpgradeable} contract for test purposes.
 */
contract WhitelistableExUpgradeableMock is WhitelistableExUpgradeable {

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __WhitelistableEx_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __WhitelistableEx_init_unchained();
    }
}
