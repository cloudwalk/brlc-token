// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BlacklistableUpgradeable } from "../../base/BlacklistableUpgradeable.sol";

/**
 * @title BlacklistableUpgradeableMock contract
 * @dev An implementation of the {BlacklistableUpgradeable} contract for test purposes.
 */
contract BlacklistableUpgradeableMock is BlacklistableUpgradeable {
    event TestNotBlacklistedModifierSucceeded();

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __Blacklistable_init();
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
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
