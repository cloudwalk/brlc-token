// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { PausableExtUpgradeable } from "../../base/PausableExtUpgradeable.sol";

/**
 * @title PausableExtUpgradeableMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {PausableExtUpgradeable} contract for test purposes.
 */
contract PausableExtUpgradeableMock is PausableExtUpgradeable {
    /**
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     */
    function initialize() public initializer {
        __PausableExt_init();
    }

    /**
     * @dev Needed to check that the internal initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init() public {
        __PausableExt_init();
    }

    /**
     * @dev Needed to check that the internal unchained initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init_unchained() public {
        __PausableExt_init_unchained();
    }
}
