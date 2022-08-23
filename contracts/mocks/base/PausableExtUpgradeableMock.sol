// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { PausableExtUpgradeable } from "../../base/PausableExtUpgradeable.sol";

/**
 * @title PausableExtUpgradeableMock contract
 * @dev An implementation of the {PausableExtUpgradeable} contract for test purposes.
 */
contract PausableExtUpgradeableMock is PausableExtUpgradeable {
    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __PausableExt_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __PausableExt_init_unchained();
    }
}
