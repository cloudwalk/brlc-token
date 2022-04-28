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
 * @title PixCashierUpgradeable contract
 * @notice Wrapper for Pix cash-in and cash-out transactions
 */
contract PixCashierUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;

    address public token;
    mapping(address => uint256) private _cashOutBalances;

    event CashIn(address indexed account, uint256 amount);
    event CashOut(address indexed account, uint256 amount, uint256 balance);
    event CashOutConfirm(
        address indexed account,
        uint256 amount,
        uint256 balance
    );
    event CashOutReverse(
        address indexed account,
        uint256 amount,
        uint256 balance
    );

    function initialize(address token_) public initializer {
        __PixCashier_init(token_);
    }

    function __PixCashier_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __PixCashier_init_unchained(token_);
    }

    function __PixCashier_init_unchained(address token_) internal initializer {
        token = token_;
    }

    /**
     * @notice Returns cash-out balance
     * @param account The address of the tokens owner
     */
    function cashOutBalanceOf(address account)
        external
        view
        virtual
        returns (uint256)
    {
        return _cashOutBalances[account];
    }

    /**
     * @notice Executes cash-in transaction
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
     * @notice Initiates cash-out transaction
     * Can only be called when contract is not paused
     * Emits an {CashOut} event
     * @param amount The amount of tokens to be transferred to the contract
     */
    function cashOut(uint256 amount) external whenNotPaused {
        IERC20Upgradeable(token).transferFrom(
            _msgSender(),
            address(this),
            amount
        );
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].add(
            amount
        );
        emit CashOut(_msgSender(), amount, _cashOutBalances[_msgSender()]);
    }

    /**
     * @notice Confirms cash-out transaction
     * Can only be called when contract is not paused
     * Emits an {CashOutConfirm} event
     * @param amount The amount of tokens to be burned
     */
    function cashOutConfirm(uint256 amount) external whenNotPaused {
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].sub(
            amount,
            "PixCashier: cash-out confirm amount exceeds balance"
        );
        IERC20Mintable(token).burn(amount);
        emit CashOutConfirm(
            _msgSender(),
            amount,
            _cashOutBalances[_msgSender()]
        );
    }

    /**
     * @notice Reverts cash-out transaction
     * Can only be called when contract is not paused
     * Emits an {CashOutReverse} event
     * @param amount The amount of tokens to be transferred back to the sender
     */
    function cashOutReverse(uint256 amount) external whenNotPaused {
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].sub(
            amount,
            "PixCashier: cash-out reverse amount exceeds balance"
        );
        IERC20Upgradeable(token).transfer(_msgSender(), amount);
        emit CashOutReverse(
            _msgSender(),
            amount,
            _cashOutBalances[_msgSender()]
        );
    }
}
