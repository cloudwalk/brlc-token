// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { RescuableUpgradeable } from "../../base/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {RescuableUpgradeable} contract for test purposes.
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {
    /**
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     */
    function initialize() public initializer {
        __Rescuable_init();
    }

    /**
     * @dev Needed to check that the internal initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init() public {
        __Rescuable_init();
    }

    /**
     * @dev Needed to check that the internal unchained initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init_unchained() public {
        __Rescuable_init_unchained();
    }
}
