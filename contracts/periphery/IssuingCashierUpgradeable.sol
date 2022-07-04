// SPDX-License-Identifier: UNLICENSED

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";
import {WhitelistableUpgradeable} from "../base/WhitelistableUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";
import {IERC20Mintable} from "../base/interfaces/IERC20Mintable.sol";

/**
 * @title IssuingCashierUpgradeable contract
 * @dev Wrapper for the Issuing operation.
 */
contract IssuingCashierUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;
    address public token;
    mapping(address => uint256) private _unclearedBalances;
    mapping(address => uint256) private _clearedBalances;

    event CardPayment(address indexed account, uint256 amount);
    event CardPaymentClear(address indexed account, uint256 amount, uint256 cleared_balance, uint256 uncleared_balance);
    event CardPaymentUnclear(address indexed account, uint256 amount, uint256 cleared_balance, uint256 uncleared_balance);
    event CardPaymentReverse(address indexed account, uint256 amount, bytes32 indexed original_transaction);

    function initialize(address token_) public initializer {
        __IssuingCashier_init(token_);
    }

    function __IssuingCashier_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __IssuingCashier_init_unchained(token_);
    }

    function __IssuingCashier_init_unchained(address token_) internal initializer {
        token = token_;
    }

    function unclearedBalanceOf(address account)
        external
        view
        virtual
    returns(uint256) {
        return _unclearedBalances[account];
    }

    function clearedBalanceOf(address account)
        external
        view
        virtual
    returns(uint256) {
        return _clearedBalances[account];
    }

    function cardPayment(address account, uint256 amount)
        external
        whenNotPaused
    {
        IERC20Upgradeable(token).transferFrom(
            _msgSender(),
            address(this),
            amount
        );

        _unclearedBalances[_msgSender()] = _unclearedBalances[_msgSender()].add(amount);
        emit CardPayment(account, amount);
    }

    function cardPaymentClear(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        _clearedBalances[account] = _clearedBalances[account].add(
            amount
        );

        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "IssuingCashier: trying to clear amount greater than uncleared balance"
        );

        emit CardPaymentClear(
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    function cardPaymentUnclear(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        _unclearedBalances[account] = _unclearedBalances[account].add(
            amount
        );

        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "IssuingCashier: trying to unclear amount greater than cleared balance"
        );

        emit CardPaymentUnclear(
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    /*
     * @dev Initiates a card payment reversal
     * Can only be called by whitelisted address
     * Can only be called when contract is not paused
     * Emits a {CardPaymentReverse} event
     *
    */
    function cardPaymentReverse(address account, uint256 amount, bytes32 original_transaction)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {}


    // function to bulk transfer all uncleared money to cleared?
    // function to bulk burn all cleared money?
}
