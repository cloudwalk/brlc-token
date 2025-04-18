// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title ERC20TokenMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {ERC20Upgradeable} contract for testing purposes
 */
contract ERC20TokenMock is ERC20Upgradeable {
    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20_init(name_, symbol_);
    }

    /**
     * @notice Calls the appropriate internal function to mint needed amount of tokens for an account
     *
     * @param account The address of an account to mint for
     * @param amount The amount of tokens to mint
     */
    function mintForTest(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }
}
