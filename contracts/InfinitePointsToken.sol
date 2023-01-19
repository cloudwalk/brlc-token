// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BRLCTokenBase } from "./BRLCTokenBase.sol";

/**
 * @title InfinitePointsToken contract
 * @author CloudWalk Inc.
 * @dev The Infinite Points token implementation.
 */
contract InfinitePointsToken is BRLCTokenBase {
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
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     * @param totalSupply_ The total supply of the token.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_
    ) external virtual initializer {
        __InfinitePointsToken_init(name_, symbol_, totalSupply_);
    }

    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See {InfinitePointsToken-initialize}.
     */
    function __InfinitePointsToken_init(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCTokenBase_init_unchained();

        __InfinitePointsToken_init_unchained(totalSupply_);
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     *
     * See {InfinitePointsToken-initialize}.
     */
    function __InfinitePointsToken_init_unchained(uint256 totalSupply_) internal onlyInitializing {
        _mint(owner(), totalSupply_);
    }
}
