// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title ERC20UpgradeableMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {ERC20Upgradeable} contract for test purposes.
 */
contract ERC20UpgradeableMock is ERC20Upgradeable {
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
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     *
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }
}
