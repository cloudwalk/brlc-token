// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { RescuableUpgradeable } from "./common/RescuableUpgradeable.sol";
import { PausableExtUpgradeable } from "./common/PausableExtUpgradeable.sol";
import { BlacklistableUpgradeable } from "./common/BlacklistableUpgradeable.sol";

/**
 * @title ERC20Base contract
 * @author CloudWalk Inc.
 * @dev This contract is base implementation of the BRLC token with inherited Rescuable,
 * Pausable, and Blacklistable functionality.
 */
abstract contract ERC20Base is
    OwnableUpgradeable,
    RescuableUpgradeable,
    PausableExtUpgradeable,
    BlacklistableUpgradeable,
    ERC20Upgradeable
{
    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function __ERC20Base_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     *
     * See {ERC20Base-__ERC20Base_init}.
     */
    function __ERC20Base_init_unchained() internal onlyInitializing {}

    /**
     * @dev See {ERC20Upgradeable-decimals}.
     */
    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    /**
     * @dev See {ERC20Upgradeable-_approve}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - The `owner` address must not be blacklisted.
     * - The `spender` address must not be blacklisted.
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused notBlacklisted(owner) notBlacklisted(spender) {
        super._approve(owner, spender, amount);
    }

    /**
     * @dev See {ERC20Upgradeable-_spendAllowance}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - The `owner` address must not be blacklisted.
     * - The `spender` address must not be blacklisted.
     */
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused notBlacklisted(owner) notBlacklisted(spender) {
        super._spendAllowance(owner, spender, amount);
    }

    /**
     * @dev See {ERC20Upgradeable-_beforeTokenTransfer}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - The `from` address must not be blacklisted.
     * - The `to` address must not be blacklisted.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused notBlacklisted(from) notBlacklisted(to) {
        super._beforeTokenTransfer(from, to, amount);
    }
}
