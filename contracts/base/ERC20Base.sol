// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlExtUpgradeable } from "./core/AccessControlExtUpgradeable.sol";
import { RescuableUpgradeable } from "./core/RescuableUpgradeable.sol";
import { PausableExtUpgradeable } from "./core/PausableExtUpgradeable.sol";

import { LegacyCorePlaceholder } from "../legacy/LegacyCorePlaceholder.sol";
import { ERC20Upgradeable } from "../openzeppelin_v4-9-6/ERC20Upgradeable.sol";

/**
 * @title ERC20Base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev This contract is base implementation of the BRLC token with inherited AccessControl, Rescuable,
 * Pausable functionality.
 */
abstract contract ERC20Base is
    LegacyCorePlaceholder,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    ERC20Upgradeable
{
    // ------------------ Errors ---------------------------------- //

    /// @dev Throws if the zero address is passed to the function.
    error ZeroAddress();

    /// @dev Throws if the zero amount is passed to the function.
    error ZeroAmount();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The internal initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function __ERC20Base_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __ERC20_init(name_, symbol_);
        __ERC20Base_init_unchained();
    }

    /**
     * @dev The unchained internal initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     */
    function __ERC20Base_init_unchained() internal onlyInitializing {
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ View functions -------------------------- //

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

    // ------------------ Internal functions ---------------------- //

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev Requirement: the contract must not be paused.
     */
    function _approve(
        address owner, // Tools: prevent Prettier one-liner
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._approve(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev Requirements: The contract must not be paused.
     */
    function _spendAllowance(
        address owner, // Tools: prevent Prettier one-liner
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._spendAllowance(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev Requirements: The contract must not be paused.
     */
    function _beforeTokenTransfer(
        address from, // Tools: prevent Prettier one-liner
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
    }
}
