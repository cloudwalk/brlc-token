// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {BaseTokenUpgradeable} from "./core/BaseTokenUpgradeable.sol";

/**
 * @title SubstrateBRLCTokenUpgradeable contract
 */
contract SubstrateBRLCTokenUpgradeable is BaseTokenUpgradeable {
    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public virtual initializer {
        __SubstrateBRLCToken_init(name_, symbol_, decimals_);
    }

    function __SubstrateBRLCToken_init(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BaseToken_init_unchained(decimals_);
        __SubstrateBRLCToken_init_unchained();
    }

    function __SubstrateBRLCToken_init_unchained() internal initializer {}
}
