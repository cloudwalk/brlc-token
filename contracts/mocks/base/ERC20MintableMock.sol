// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Mintable } from "../../base/ERC20Mintable.sol";

/**
 * @title ERC20MintableMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {ERC20Mintable} contract for testing purposes
 */
contract ERC20MintableMock is ERC20Mintable {
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
        __ERC20Mintable_init(name_, symbol_);
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function call_parent_initialize(string memory name_, string memory symbol_) public {
        __ERC20Mintable_init(name_, symbol_);
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __ERC20Mintable_init_unchained();
    }

    /**
     * @inheritdoc ERC20Mintable
     */
    function _balanceOf_ERC20Mintable(address account, address recipient) internal view virtual override returns (uint256) {
        return balanceOf(account);
    }
}
