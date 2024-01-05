// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Restrictable } from "../../base/ERC20Restrictable.sol";

/**
 * @title ERC20RestrictableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {ERC20Restrictable} contract for testing purposes
 */
contract ERC20RestrictableMock is ERC20Restrictable {
    /**
     * @notice Constructor that prohibits the initialization of the implementation of the upgradable contract
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
     * @notice The initialize function of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20Restrictable_init(name_, symbol_);
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function call_parent_initialize(string memory name_, string memory symbol_) public {
        __ERC20Restrictable_init(name_, symbol_);
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __ERC20Restrictable_init_unchained();
    }

    /**
     * @notice Calls the appropriate internal function to mint needed amount of tokens for an account
     *
     * @param account The address of an account to mint for
     * @param amount The amount of tokens to mint
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    /**
     * @inheritdoc ERC20Restrictable
     */
    function _balanceOf_ERC20Restrictable(
        address account
    ) internal view virtual override returns (uint256) {
        return balanceOf(account);
    }
}
