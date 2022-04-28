// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";
import {WhitelistableUpgradeable} from "../base/WhitelistableUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";
import {IERC20Mintable} from "../base/interfaces/IERC20Mintable.sol";

/**
 * @title BrlcCashierUpgradeable contract
 * @notice Wraps BRLC cash-in and cash-out functionality
 */
contract BrlcCashierUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;

    address public token;

    event CashIn(address indexed account, uint256 amount);
    event CashOut(address indexed account, uint256 amount);

    function initialize(address token_) public initializer {
        __BrlcCashier_init(token_);
    }

    function __BrlcCashier_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __BrlcCashier_init_unchained(token_);
    }

    function __BrlcCashier_init_unchained(address token_) internal initializer {
        token = token_;
    }

    /**
     * @notice Executes cash-out transaction
     * Can only be called when contract is not paused
     * Can only be called by whitelisted address
     * Emits an {CashIn} event
     * @param account The address that will receive tokens
     * @param amount The amount of tokens to be minted
     */
    function cashIn(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        IERC20Mintable(token).mint(account, amount);
        emit CashIn(account, amount);
    }

    /**
     * @notice Executes cash-out transaction
     * Can only be called when contract is not paused
     * Emits an {CashOut} event
     * @param amount The amount of tokens to be burned
     */
    function cashOut(uint256 amount)
        external
        whenNotPaused
    {
        IERC20Upgradeable(token).transferFrom(_msgSender(), address(this), amount);
        IERC20Mintable(token).burn(amount);
        emit CashOut(_msgSender(), amount);
    }
}
