// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {MintableTokenUpgradeable} from "../../tokens/core/MintableTokenUpgradeable.sol";

/**
 * @title MintableTokenUpgradeableMock contract
 * @dev An implementation of the {MintableTokenUpgradeable} contract for test purposes.
 */
contract MintableTokenUpgradeableMock is MintableTokenUpgradeable {

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     * @param decimals_ The decimals of the token to set for this ERC20-comparable contract.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public {
        __MintableToken_init(name_, symbol_, decimals_);
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __MintableToken_init_unchained();
    }
}
