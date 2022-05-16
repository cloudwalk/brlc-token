// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableUpgradeable} from "../../base/WhitelistableUpgradeable.sol";

/**
 * @title WhitelistableUpgradeableMock contract
 * @notice An implementation of the {WhitelistableUpgradeable} contract for test purposes.
 */
contract WhitelistableUpgradeableMock is WhitelistableUpgradeable {

    bool private _isWhitelistEnabled;
    address private _stubWhitelister;

    event TestOnlyWhitelistAdminModifierSucceeded();
    event TestOnlyWhitelistedModifierSucceeded();

    /**
     * @notice The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize() public {
        __Whitelistable_init();
    }

    /**
     * @notice The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __Whitelistable_init_unchained();
    }

    /**
     * @notice Checks if the whitelist is enabled.
     * @return True if enabled.
     */
    function isWhitelistEnabled() public override view returns (bool) {
        return _isWhitelistEnabled;
    }

    /**
     * @notice Allows to enable or disable the whitelist.
     * @param enabled True for enabling, False - for disabling.
     */
    function setWhitelistEnabled(bool enabled) external {
        _isWhitelistEnabled = enabled;
    }

    /**
     * @notice Checks if an account is a whitelister.
     * @param account The address of an account to check.
     * @return True if an account is a whitelister, False otherwise.
     */
    function isWhitelister(address account) public override view returns (bool) {
        return (_stubWhitelister == account);
    }

    /**
     * @notice Set an account as a stub wthitelister for test purposes.
     * @param account The account's address to set as a wthitelister.
     */
    function setStubWhitelister(address account) external {
        _stubWhitelister = account;
    }

    /**
     * @notice Checks the execution of the {onlyWhitelistAdmin} modifier.
     * If that modifier executed without reverting emits an event {TestOnlyWhitelistAdminModifierSucceeded}.
     */
    function testOnlyWhitelistAdminModifier() external onlyWhitelistAdmin {
        emit TestOnlyWhitelistAdminModifierSucceeded();
    }

    /**
     * @notice Checks the execution of the {onlyWhitelisted} modifier.
     * If that modifier executed without reverting emits an event {TestOnlyWhitelistedModifierSucceeded}.
     */
    function testOnlyWhitelistedModifier() external onlyWhitelisted(_msgSender()) {
        emit TestOnlyWhitelistedModifierSucceeded();
    }
}
