// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Base } from "./base/ERC20Base.sol";
import { ERC20Bridgeable } from "./base/ERC20Bridgeable.sol";
import { ERC20Freezable } from "./base/ERC20Freezable.sol";

/**
 * @title BRLCTokenBridgeable contract
 * @author CloudWalk Inc.
 * @dev The BRLC token implementation that supports the bridge operations.
 */
contract BRLCTokenBridgeable is ERC20Base, ERC20Bridgeable, ERC20Freezable {
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
     * Requirements:
     *
     * - The passed bridge address must not be zero.
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     * @param bridge_ The address of a bridge contract to support by this contract.
     */
    function initialize(string memory name_, string memory symbol_, address bridge_) external virtual initializer {
        __BRLCTokenBridgeable_init(name_, symbol_, bridge_);
    }

    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See {BRLCTokenBridgeable-initialize}.
     */
    function __BRLCTokenBridgeable_init(
        string memory name_,
        string memory symbol_,
        address bridge_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Bridgeable_init_unchained(bridge_);
        __ERC20Freezable_init_unchained();
        __BRLCTokenBridgeable_init_unchained();
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     *
     * See {BRLCTokenBridgeable-initialize}.
     */
    function __BRLCTokenBridgeable_init_unchained() internal onlyInitializing {}

    /**
     * @dev Returns true if token is BRLCoin implementation.
     */
    function isBRLCoin() external pure returns (bool) {
        return true;
    }

    /**
     * @dev See {ERC20Upgradeable-_beforeTokenTransfer}.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Base, ERC20Freezable) {
        super._beforeTokenTransfer(from, to, amount);
    }
}
