// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title ERC20TestMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {ERC20Upgradeable} contract for test purposes.
 */
contract ERC20TestMock is ERC20Upgradeable {
    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
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
     * @dev The initialize function of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20_init(name_, symbol_);
    }

    /**
     * @dev Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier.
     *
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     */
    function call_parent_initialize(string memory name_, string memory symbol_) public {
        __ERC20_init(name_, symbol_);
    }

    /**
     * @dev Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_initialize_unchained(string memory name_, string memory symbol_) public {
        __ERC20_init_unchained(name_, symbol_);
    }

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     *
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function testMint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }
}