// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {SubstrateBRLCTokenUpgradeable} from "./SubstrateBRLCTokenUpgradeable.sol";
import {MintableTokenUpgradeable} from "./core/MintableTokenUpgradeable.sol";

/**
 * @title SubstrateBRLCTokenV2Upgradeable contract
 * @dev V2 changes:
 * - Added minting and burning functionality
 */
contract SubstrateBRLCTokenV2Upgradeable is
    SubstrateBRLCTokenUpgradeable,
    MintableTokenUpgradeable
{
    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public virtual override initializer {
        __SubstrateBRLCTokenV2_init(name_, symbol_, decimals_);
    }

    function __SubstrateBRLCTokenV2_init(
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
        __MintableToken_init_unchained();
        __SubstrateBRLCTokenV2_init_unchained();
    }

    function __SubstrateBRLCTokenV2_init_unchained() internal initializer {}
}
