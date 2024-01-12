// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { RescuableUpgradeable } from "./common/RescuableUpgradeable.sol";
import { PausableExtUpgradeable } from "./common/PausableExtUpgradeable.sol";
import { BlocklistableUpgradeable } from "./common/BlocklistableUpgradeable.sol";

/**
 * @title ERC20Base contract
 * @author CloudWalk Inc.
 * @notice This contract is base implementation of the BRLC token with inherited Rescuable,
 * Pausable, and Blocklistable functionality.
 */
abstract contract ERC20Base is
    OwnableUpgradeable,
    RescuableUpgradeable,
    PausableExtUpgradeable,
    BlocklistableUpgradeable,
    ERC20Upgradeable
{
    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function __ERC20Base_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {ERC20Base-__ERC20Base_init}
     */
    function __ERC20Base_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `owner` address must not be blocklisted
     * @dev The `spender` address must not be blocklisted
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused notBlocklisted(owner) notBlocklisted(spender) {
        super._approve(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `owner` address must not be blocklisted
     * @dev The `spender` address must not be blocklisted
     */
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused notBlocklisted(owner) notBlocklisted(spender) {
        super._spendAllowance(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `from` address must not be blocklisted
     * @dev The `to` address must not be blocklisted
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused notBlocklisted(from) notBlocklistedOrBypassIfBlocklister(to) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
    }
}
