// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Restrictable contract
 * @author CloudWalk Inc.
 */
abstract contract ERC20Restrictable is ERC20Base {
    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[50] private __gap;
}
