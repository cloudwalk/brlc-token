// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableExUpgradeable} from "../../base/WhitelistableExUpgradeable.sol";

/**
 * @title WhitelistableExUpgradeableMock contract
 * @notice An implementation of the {WhitelistableExUpgradeable} contract for test purposes.
 */
contract WhitelistableExUpgradeableMock is WhitelistableExUpgradeable {

    /**
     * @notice The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __WhitelistableEx_init();
    }

    /**
     * @notice The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __WhitelistableEx_init_unchained();
    }
}
