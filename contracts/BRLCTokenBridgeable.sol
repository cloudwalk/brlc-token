// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { ERC20Base } from "./base/ERC20Base.sol";
import { ERC20Bridgeable } from "./base/ERC20Bridgeable.sol";
import { ERC20Freezable } from "./base/ERC20Freezable.sol";

/**
 * @title BRLCTokenBridgeable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The BRLC token implementation that supports bridging operations
 */
contract BRLCTokenBridgeable is ERC20Base, ERC20Bridgeable, ERC20Freezable {
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
     * @notice The initializer of the upgradable contract
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * Requirements:
     *
     * - The passed bridge address must not be zero
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param bridge_ The address of the bridge contract
     */
    function initialize(string memory name_, string memory symbol_, address bridge_) external virtual initializer {
        __ERC20Base_init(name_, symbol_);
        __ERC20Bridgeable_init_unchained(bridge_);
        __ERC20Freezable_init_unchained();
    }

    /**
     * @notice Returns true if token is BRLCoin implementation
     */
    function isBRLCoin() external pure returns (bool) {
        return true;
    }

    /**
     * @dev See {ERC20Base-_beforeTokenTransfer}
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20Base) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev See {ERC20Base-_afterTokenTransfer}
     * @dev See {ERC20Freezable-_afterTokenTransfer}
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Base) {
        super._afterTokenTransfer(from, to, amount);
    }
}
