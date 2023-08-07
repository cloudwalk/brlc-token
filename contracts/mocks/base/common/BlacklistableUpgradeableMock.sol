// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BlacklistableUpgradeable } from "../../../base/common/BlacklistableUpgradeable.sol";

/**
 * @title BlacklistableUpgradeableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {BlacklistableUpgradeable} contract for testing purposes
 */
contract BlacklistableUpgradeableMock is BlacklistableUpgradeable {
    /// @notice Emitted when a test function of the `notBlacklisted` modifier executes successfully
    event TestNotBlacklistedModifierSucceeded();

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
        __Blacklistable_init();
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize() public {
        __Blacklistable_init();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __Blacklistable_init_unchained();
    }

    /**
     * @notice Checks the execution of the {notBlacklisted} modifier
     * Emits an event {TestNotBlacklistedModifierSucceeded} if modifier is not reverted
     */
    function testNotBlacklistedModifier() external notBlacklisted(_msgSender()) {
        emit TestNotBlacklistedModifierSucceeded();
    }
}
