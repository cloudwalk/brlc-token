// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {RescuableUpgradeable} from "../../base/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @notice An implementation of the {RescuableUpgradeable} contract for test purposes.
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {

    /**
     * @notice The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __Rescuable_init();
    }

    /**
     * @notice The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __Rescuable_init_unchained();
    }
}
