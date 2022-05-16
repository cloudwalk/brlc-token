// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {RescuableUpgradeable} from "../../base/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract.
 * @notice For test purpose of the "RescuableUpgradeable" contract.
 */
contract RescuableUpgradeableMock is RescuableUpgradeable {

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize() public {
        __Rescuable_init();
    }

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained() public {
        __Rescuable_init_unchained();
    }
}
