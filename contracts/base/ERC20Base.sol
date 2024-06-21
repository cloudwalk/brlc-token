// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

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
    /// @dev Throws if the zero address is passed to the function
    error ZeroAddress();

    /// @dev Throws if the zero amount is passed to the function
    error ZeroAmount();

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
     * @notice Transfers `amount` tokens from the caller's account to `to`
     *
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens to be transferred
     *
     * @return bool Returns `true` if the transfer is successful
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        _transferWithId(_msgSender(), to, amount, bytes32(0));
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from `from` to `to` using the allowance mechanism
     *
     * @param from The address of the owner of tokens
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens to be transferred
     *
     * @return bool Returns `true` if the transfer is successful
     */
    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transferWithId(from, to, amount, bytes32(0));
        return true;
    }

    /**
     * @notice Transfers `amount` tokens from `from` to `to` with an additional identifier
     *
     * @param from The address of the owner of tokens
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens to be transferred
     * @param id An additional identifier for the transfer
     *
     * @return bool Returns `true` if the transfer is successful
     */
    function transferFromWithId(
        address from,
        address to,
        uint256 amount,
        bytes32 id
    ) public virtual returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transferWithId(from, to, amount, id);
        return true;
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return super.allowance(owner, spender);
    }

    /**
     * @notice Internal function to transfer `amount` tokens from `from` to `to` with an additional identifier
     *
     * @param from The address of the owner of tokens
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens to be transferred
     * @param id An additional identifier for the transfer
     */
    function _transferWithId(
        address from,
        address to,
        uint256 amount,
        bytes32 id
    ) internal {
        _beforeTokenTransferWithId(from, to, amount, id);
        _transfer(from, to, amount);
        _afterTokenTransferWithId(from, to, amount, id);
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
     * @notice Hook that is called before any transfer of tokens
     * @dev Checks that the contract is not paused and neither `from` nor `to` addresses are blocklisted
     *
     * @param from The address of the owner of tokens
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens to be transferred
     * @param id An additional identifier for the transfer
     */
    function _beforeTokenTransferWithId(
        address from,
        address to,
        uint256 amount,
        bytes32 id
    ) internal virtual whenNotPaused notBlocklisted(from) notBlocklistedOrBypassIfBlocklister(to) {}

    /**
     * @notice Hook that is called after any transfer of tokens
     *
     * @param from The address of the owner of tokens
     * @param to The address of the receiver of tokens
     * @param amount The amount of tokens that were transferred
     * @param id An additional identifier for the transfer
     */
    function _afterTokenTransferWithId(address from, address to, uint256 amount, bytes32 id) internal virtual {}


    /// @dev for backward compatibility with ERC20Mintable (_mint and _burn checks)

    /**
     * @inheritdoc ERC20Upgradeable
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
