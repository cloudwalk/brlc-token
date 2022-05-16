// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {SpinMachineUpgradeable} from "../../rewards/SpinMachineUpgradeable.sol";

/**
 * @title SpinMachineUpgradeableMock contract
 * @dev An implementation of the {SpinMachineUpgradeable} contract for test purposes.
 */
contract SpinMachineUpgradeableMock is SpinMachineUpgradeable {

    bool private _isWhitelistEnabled;
    address private _stubWhitelister;

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param token_ The address of a token that can be won.
     */
    function initialize(address token_) public {
        __SpinMachine_init(token_);
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param token_ The address of a token that can be won.
     */
    function initialize_unchained(address token_) public {
        __SpinMachine_init_unchained(token_);
    }

    /**
     * @dev Checks if the whitelist is enabled.
     * @return True if enabled.
     */
    function isWhitelistEnabled() public override view returns (bool) {
        return _isWhitelistEnabled;
    }

    /**
     * @dev Allows to enable or disable the whitelist.
     * @param enabled True for enabling, False - for disabling.
     */
    function setWhitelistEnabled(bool enabled) external {
        _isWhitelistEnabled = enabled;
    }

    /**
     * @dev Checks if an account is a whitelister.
     * @param account The address of an account to check.
     * @return True if an account is a whitelister, False otherwise.
     */
    function isWhitelister(address account) public override view returns (bool) {
        return (_stubWhitelister == account);
    }

    /**
     * @dev Set an account as a stub wthitelister for test purposes.
     * @param account The account's address to set as a wthitelister.
     */
    function setStubWhitelister(address account) external {
        _stubWhitelister = account;
    }
}
