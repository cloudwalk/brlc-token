// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BlacklistableUpgradeable } from "../../base/BlacklistableUpgradeable.sol";

/**
 * @title BlacklistableUpgradeableMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {BlacklistableUpgradeable} contract for test purposes.
 */
contract BlacklistableUpgradeableMock is BlacklistableUpgradeable {
    /// @dev Emitted when a test function of the `notBlacklisted` modifier executes successfully.
    event TestNotBlacklistedModifierSucceeded();

    /**
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     */
    function initialize() public initializer {
        __Blacklistable_init();
    }

    /**
     * @dev Needed to check that the internal initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init() public {
        __Blacklistable_init();
    }

    /**
     * @dev Needed to check that the internal unchained initializer of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_init_unchained() public {
        __Blacklistable_init_unchained();
    }

    /**
     * @dev Checks the execution of the {notBlacklisted} modifier.
     * If that modifier executed without reverting emits an event {TestNotBlacklistedModifierSucceeded}.
     */
    function testNotBlacklistedModifier() external notBlacklisted(_msgSender()) {
        emit TestNotBlacklistedModifierSucceeded();
    }
}
