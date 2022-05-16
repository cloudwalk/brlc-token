// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {SpinMachineUpgradeable} from "../../rewards/SpinMachineUpgradeable.sol";

/**
 * @title SpinMachineUpgradeableMock contract
 * @notice An implementation of the {SpinMachineUpgradeable} contract for test purposes.
 */
contract SpinMachineUpgradeableMock is SpinMachineUpgradeable {

    bool private _isWhitelistEnabled;
    address private _stubWhitelister;

    /**
     * @notice The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param token_ The address of a token that can be won.
     */
    function initialize(address token_) public {
        __SpinMachine_init(token_);
    }

    /**
     * @notice The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param token_ The address of a token that can be won.
     */
    function initialize_unchained(address token_) public {
        __SpinMachine_init_unchained(token_);
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
}
