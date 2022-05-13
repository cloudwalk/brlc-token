// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {RandomableUpgradeable} from "../../base/RandomableUpgradeable.sol";

/**
 * @title RandomableUpgradeableMock contract.
 * @notice For test purpose of the "RandomableUpgradeable" contract.
 */
contract RandomableUpgradeableMock is RandomableUpgradeable {

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize() public {
        __Randomable_init();
    }

    //This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained() public {
        __Randomable_init_unchained();
    }

    function getRandomness() external view returns (uint256) {
        return _getRandomness();
    }
}
