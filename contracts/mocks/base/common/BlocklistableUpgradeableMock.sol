// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { BlocklistableUpgradeable } from "../../../base/common/BlocklistableUpgradeable.sol";

/**
 * @title BlocklistableUpgradeableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {BlocklistableUpgradeable} contract for testing purposes
 */
contract BlocklistableUpgradeableMock is BlocklistableUpgradeable {
    /// @notice Emitted when a test function of the `notBlocklisted` modifier executes successfully
    event TestNotBlocklistedModifierSucceeded();

    /// @notice Emitted when a test function of the `notBlocklistedOrBypassIfBlocklister` modifier executes successfully
    event TestNotBlocklistedOrBypassIfBlocklisterModifierSucceeded();

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
        __Blocklistable_init();
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize() public {
        __Blocklistable_init();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __Blocklistable_init_unchained();
    }

    /**
     * @notice Checks the execution of the {notBlocklisted} modifier
     * Emits an event {TestNotBlocklistedModifierSucceeded} if modifier is not reverted
     */
    function testNotBlocklistedModifier() external notBlocklisted(_msgSender()) {
        emit TestNotBlocklistedModifierSucceeded();
    }

    /**
     * @notice Checks the execution of the {notBlocklistedOrBypassIfBlocklister} modifier
     * Emits an event {TestNotBlocklistedOrBypassIfBlocklisterModifierSucceeded} if modifier is not reverted
     */
    function testNotBlocklistedOrBypassIfBlocklister() external notBlocklistedOrBypassIfBlocklister(_msgSender()) {
        emit TestNotBlocklistedOrBypassIfBlocklisterModifierSucceeded();
    }
}
