// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { CWToken } from "../../base/CWToken.sol";

/**
 * @title CWTokenMock.sol contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {CWToken} contract for testing purposes
 */
contract CWTokenMock is CWToken {
    /**
     * @notice Constructor that prohibits the initialization of the implementation of the upgradable contract
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __CWToken_init(name_, symbol_);

        // Only to provide the 100 % test coverage
        __CWToken_init_unchained();
    }

    /**
     * @notice Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function call_parent_initialize(string memory name_, string memory symbol_) public {
        __CWToken_init(name_, symbol_);
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __CWToken_init_unchained();
    }
}
