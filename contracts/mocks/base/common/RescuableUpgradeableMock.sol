// SPDX-License-Identifier: MIT

 pragma solidity ^0.8.4;

import { RescuableUpgradeable } from "../../../base/common/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {RescuableUpgradeable} contract for testing purposes
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {
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
        __Rescuable_init();
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize() public {
        __Rescuable_init();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __Rescuable_init_unchained();
    }
}
