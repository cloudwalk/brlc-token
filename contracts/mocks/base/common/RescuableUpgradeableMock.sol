// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { RescuableUpgradeable } from "../../../base/common/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {RescuableUpgradeable} contract for testing purposes
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {
    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     */
    function initialize() public initializer {
        __Ownable_init();
        __Rescuable_init_unchained();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __Rescuable_init_unchained();
    }
}
