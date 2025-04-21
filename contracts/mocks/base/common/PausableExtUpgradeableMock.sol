// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { PausableExtUpgradeable } from "../../../base/common/PausableExtUpgradeable.sol";

/**
 * @title PausableExtUpgradeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {PausableExtUpgradeable} contract for testing purposes
 */
contract PausableExtUpgradeableMock is PausableExtUpgradeable {
    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     */
    function initialize() public initializer {
        __Ownable_init_unchained(); // This is needed only to avoid errors during coverage assessment
        __Pausable_init();
        __PausableExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        _grantRole(OWNER_ROLE, _msgSender());
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __PausableExt_init_unchained();
    }
}
