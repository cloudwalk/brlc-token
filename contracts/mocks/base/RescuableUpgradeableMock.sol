// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { RescuableUpgradeable } from "../../base/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @dev An implementation of the {RescuableUpgradeable} contract for test purposes.
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {
    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __Rescuable_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __Rescuable_init_unchained();
    }
}
