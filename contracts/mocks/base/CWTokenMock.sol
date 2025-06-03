// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { CWToken } from "../../base/CWToken.sol";

/**
 * @title CWTokenMock.sol contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {CWToken} contract for testing purposes
 */
contract CWTokenMock is CWToken {
    /**
     * @notice The initialize function of the upgradeable contract
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
     * @notice Calls the parent internal initializing function to verify the 'onlyInitializing' modifier
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function callParentInitializer(string memory name_, string memory symbol_) public {
        __CWToken_init(name_, symbol_);
    }

    /**
     * @notice Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier
     */
    function callParentInitializerUnchained() public {
        __CWToken_init_unchained();
    }
}
