// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";
import {SpinMachineUpgradeable} from "./SpinMachineUpgradeable.sol";

/**
 * @title SpinMachineV2Upgradeable contract
 * @dev Allows accounts to execute spins and win underlying tokens.
 */
contract SpinMachineV2Upgradeable is
    SpinMachineUpgradeable,
    WhitelistableExUpgradeable
{
    function initialize(address token_) public initializer {
        __SpinV2Machine_init(token_);
    }

    function __SpinV2Machine_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __FaucetCaller_init_unchained();
        __Randomable_init_unchained();
        __SpinMachine_init_unchained(token_);
        __WhitelistableEx_init_unchained();
        __SpinMachineV2_init_unchained();
    }

    function __SpinMachineV2_init_unchained() internal initializer {}
}
