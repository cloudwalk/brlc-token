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
 * @title IssuingCashierUpgradeable contract
 * @dev Wrapper for the Issuing operation.
 */
contract IssuingCashierUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256; // should we use Solidity 0.8.0 already and ditch SafeMath altogether?

    address public token;

    mapping(address => uint256) private _unclearedBalances;
    mapping(address => uint256) private _clearedBalances;
    mapping(bytes32 => bool) private _reversedTransactions;

    event CardPayment(
        address indexed from,
        uint256 amount,
        bytes16 indexed clientTransactionId
    );

    event CardPaymentClear(
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event CardPaymentUnclear(
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event CardPaymentReverse(
        address indexed account,
        uint256 amount,
        uint256 unclearedBalance,
        bytes16 indexed clientTransactionId,
        bytes32 indexed parentTransactionHash
    );

    event ClearConfirm(address indexed account, uint256 amount);

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

    /**
     * @dev Returns the uncleared balance.
     * @param account The address of the token owner.
     */
    function unclearedBalanceOf(address account)
        external
        view
        virtual
    returns(uint256) {
        return _unclearedBalances[account];
    }

    /**
     * @dev Returns the cleared balance
     * @param account The address of the token owner
     */
    function clearedBalanceOf(address account)
        external
        view
        virtual
    returns(uint256) {
        return _clearedBalances[account];
    }

    /**
     * @dev Executes an Issuing operation transaction
     * Can only be called when the contract is not paused
     * Emits a {CardPayment} event
     * @param amount The transaction amount to be transferred to this contract
     * @param clientTransactionId The transaction id from the Issuing operation backend
     */
    function cardPayment(uint256 amount, bytes16 clientTransactionId)
        external
        whenNotPaused
    {
        IERC20Upgradeable(token).transferFrom(
            _msgSender(),
            address(this),
            amount
        );

        _unclearedBalances[_msgSender()] = _unclearedBalances[_msgSender()].add(amount);

        emit CardPayment(_msgSender(), amount, clientTransactionId);
    }

    /**
     * @dev Initiates a clearing operation
     * Can only be called by whitelisted address
     * Can only be called when contract is not paused
     * Emits a {CardPaymentClear} event
     */
    function cardPaymentClear(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "IssuingCashier: trying to clear amount greater than uncleared balance"
        );

        _clearedBalances[account] = _clearedBalances[account].add(amount);

        emit CardPaymentClear(
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    /**
     * @dev Initiates a clearing operation
     * Can only be called by whitelisted address
     * Can only be called when contract is not paused
     * Emits a {CardPaymentUnClear} event
     */
    function cardPaymentUnclear(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "IssuingCashier: trying to unclear amount greater than cleared balance"
        );

        _unclearedBalances[account] = _unclearedBalances[account].add(amount);

        emit CardPaymentUnclear(
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    /**
     * @dev Initiates a card payment reversal
     * Can only be called by whitelisted address
     * Can only be called when contract is not paused
     * Emits a {CardPaymentReverse} event
     *
     */
    function cardPaymentReverse(
        address account,
        uint256 amount,
        bytes16 clientTransactionId,
        bytes32 parentTransactionHash
    )
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            _reversedTransactions[parentTransactionHash] != true,
            "IssuingCashier: card payment already reversed"
        );

        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "IssuingCashier: card payment reverse amount exceeds balance"
        );

        IERC20Upgradeable(token).transfer(account, amount);

        _reversedTransactions[parentTransactionHash] = true;

        emit CardPaymentReverse(
            account,
            amount,
            _unclearedBalances[account],
            clientTransactionId,
            parentTransactionHash);
    }

    /** @dev Initiates Clearing final step (initiates token burning)
     *  Can only be called when the contract is not paused.
     *  Can only be called by whitelisted address.
     *  Emits a {ClearConfirm} event.
     *  @param account The token owner.
     *  @param amount The amount of tokens that will be burnt.
     */
    function clearConfirm(address account, uint256 amount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        // IMPLEMENTATION TO BE DEFINED
        /*
        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "IssuingCashier: clearConfirm amount exceeds cleared balance");

        IERC20Mintable(token).burnFrom(account, amount);
        // this would require implementation of IERC20Burnable or
        // adding burnFrom(account, amount) to IERC20Mintable

        emit ClearConfirm(account, amount, _clearedBalances[account]);
        */
    }
}
