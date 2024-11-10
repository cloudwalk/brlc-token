// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { CWToken } from "./base/CWToken.sol";

/**
 * @title BRLCToken contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The BRLC token implementation
 */
contract BRLCToken is CWToken {
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
     * @notice The initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) external override initializer {
        __BRLCToken_init(name_, symbol_);
    }

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See {BRLCToken-initialize}
     */
    function __BRLCToken_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __CWToken_init(name_, symbol_);
        __BRLCToken_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {BRLCToken-initialize}
     */
    function __BRLCToken_init_unchained() internal onlyInitializing {}

    /**
     * @notice Returns true if token is BRLCoin implementation
     */
    function isBRLCoin() external pure returns (bool) {
        return true;
    }
}
