// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableExUpgradeable} from "../../base/WhitelistableExUpgradeable.sol";

/**
 * @title WhitelistableExUpgradeableMock contract.
 * @notice For test purpose of the "WhitelistableExUpgradeable" contract.
 */
contract WhitelistableExUpgradeableMock is WhitelistableExUpgradeable {

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize() public {
        __WhitelistableEx_init();
    }

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained() public {
        __WhitelistableEx_init_unchained();
    }
}
