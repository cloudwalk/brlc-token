// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BRLCTokenUpgradeable } from "./BRLCTokenUpgradeable.sol";

/**
 * @title SubstrateBRLCTokenUpgradeable contract
 */
contract SubstrateBRLCTokenUpgradeable is BRLCTokenUpgradeable {
    function initialize(string memory name_, string memory symbol_) public virtual initializer {
        __SubstrateBRLCTokenUpgradeable_init(name_, symbol_);
    }

    function __SubstrateBRLCTokenUpgradeable_init(string memory name_, string memory symbol_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCToken_init_unchained();
        __SubstrateBRLCTokenUpgradeable_init_unchained();
    }

    function __SubstrateBRLCTokenUpgradeable_init_unchained() internal initializer {}
}
