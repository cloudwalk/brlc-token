// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {SpinMachineUpgradeable} from "../../rewards/SpinMachineUpgradeable.sol";

/**
 * @title SpinMachineUpgradeableMock contract.
 * @notice For test purpose of the "SpinMachineUpgradeable" abstract contract.
 */
contract SpinMachineUpgradeableMock is SpinMachineUpgradeable {

    bool private _isWhitelistEnabled;
    address private _stubWhitelister;

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize(address token_) public {
        __SpinMachine_init(token_);
    }

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained(address token_) public {
        __SpinMachine_init_unchained(token_);
    }

    function isWhitelistEnabled() public override view returns (bool) {
        return _isWhitelistEnabled;
    }

    function setWhitelistEnabled(bool enabled) external {
        _isWhitelistEnabled = enabled;
    }

    function isWhitelister(address account) public override view returns (bool) {
        return (_stubWhitelister == account);
    }

    function setStubWhitelister(address account) external {
        _stubWhitelister = account;
    }
}
