// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { CWToken } from "./base/CWToken.sol";

/**
 * @title BRLCToken contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The BRLC token implementation.
 */
contract BRLCToken is CWToken {
    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details:
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function initialize(string memory name_, string memory symbol_) external initializer {
        __CWToken_init(name_, symbol_);
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @dev Returns true if token is BRLCoin implementation.
     */
    function isBRLCoin() external pure returns (bool) {
        return true;
    }
}
