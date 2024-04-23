// SPDX-License-Identifier: MIT

 pragma solidity ^0.8.4;

import { PausableExtUpgradeable } from "../../../base/common/PausableExtUpgradeable.sol";

/**
 * @title PausableExtUpgradeableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {PausableExtUpgradeable} contract for testing purposes
 */
contract PausableExtUpgradeableMock is PausableExtUpgradeable {
    /**
     * @notice Constructor that prohibits the initialization of the implementation of the upgradable contract
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     */
    function initialize() public initializer {
        __PausableExt_init();
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize() public {
        __PausableExt_init();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __PausableExt_init_unchained();
    }
}
