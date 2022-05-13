// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {PausableExUpgradeable} from "../../base/PausableExUpgradeable.sol";

/**
 * @title PausableExUpgradeableMock contract.
 * @notice For test purpose of the "PausableExUpgradeable" contract.
 */
contract PausableExUpgradeableMock is PausableExUpgradeable {

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize() public {
        __PausableEx_init();
    }

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained() public {
        __PausableEx_init_unchained();
    }
}
