// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Base } from "./base/ERC20Base.sol";
import { ERC20Mintable } from "./base/ERC20Mintable.sol";

/**
 * @title LightningBitcoin contract
 * @author CloudWalk Inc.
 * @notice The Lightning Bitcoin token implementation
 */
contract LightningBitcoin is ERC20Base, ERC20Mintable {
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
    function initialize(string memory name_, string memory symbol_) external virtual initializer {
        __LightningBitcoin_init(name_, symbol_);
    }

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See {LightningBitcoin-initialize}
     */
    function __LightningBitcoin_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Mintable_init_unchained();
        __LightningBitcoin_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {LightningBitcoin-initialize}
     */
    function __LightningBitcoin_init_unchained() internal onlyInitializing {}

    /**
     * @notice Returns the number of decimals token uses
     */
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /**
     * @notice Returns true if token is LightningBitcoin implementation
     */
    function isLightningBitcoin() external pure returns (bool) {
        return true;
    }
}
