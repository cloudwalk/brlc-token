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
    using SafeMathUpgradeable for uint256;

    event CardPay(
        bytes16 indexed clientTransactionId,
        address indexed account,
        uint256 amount
    );

    event CardPaymentClear(
        bytes16 indexed clientTransactionId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event CardPaymentUnclear(
        bytes16 indexed clientTransactionId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event CardPaymentReverse(
        bytes16 indexed clientTransactionId,
        address indexed account,
        uint256 amount,
        uint256 unclearedBalance
    );

    event ClearConfirm(
        bytes16 indexed clientTransactionId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance
    );

    enum PaymentStatus {
        Inexistent, // 0
        Uncleared,  // 1
        Cleared,    // 2
        Confirmed,  // 3
        Reversed    // 4
    }

    struct CardPayment {
        address account;
        uint256 amount;
        PaymentStatus status;
    }

    /// @dev The address of the underlying token contract.
    address public token;

    uint256 private _totalClearedBalance;
    uint256 private _totalUnclearedBalance;

    mapping(address => uint256) private _unclearedBalances;
    mapping(address => uint256) private _clearedBalances;
    mapping(bytes16 => CardPayment) private _cardPayments;

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
     * @dev Returns the total uncleared amount locked in the contract.
     */
    function totalUnclearedBalance()
        external
        view
        virtual
        returns (uint256)
    {
        return _totalUnclearedBalance;
    }

    /**
     * @dev Returns the total uncleared amount locked in the contract.
     */
    function totalClearedBalance()
        external
        view
        virtual
        returns (uint256)
    {
        return _totalClearedBalance;
    }

    /**
     * @dev Returns the uncleared balance for an account.
     * @param account The address of the token owner.
     */
    function unclearedBalanceOf(address account)
        external
        view
        virtual
        returns (uint256)
    {
        return _unclearedBalances[account];
    }

    /**
     * @dev Returns the cleared balance for an account.
     * @param account The address of the token owner
     */
    function clearedBalanceOf(address account)
        external
        view
        virtual
        returns (uint256)
    {
        return _clearedBalances[account];
    }

    /**
     * @dev Initiates a card payment by a sender.
     * Transfers the underlying tokens from the sender to this contract.
     * Can only be called when the contract is not paused.
     * Emits a {CardPay} event.
     * @param amount The amount of tokens to be transferred to this contract.
     * @param clientTransactionId The card client transaction ID from the off-chain Issuing operation backend.
     */
    function cardPay(uint256 amount, bytes16 clientTransactionId)
        external
        whenNotPaused
    {
        CardPayment storage cardPayment = _cardPayments[clientTransactionId];
        address payable sender = _msgSender();

        require(
            cardPayment.status == PaymentStatus.Inexistent,
            "IssuingCashier: card payment with provided ID already exists"
        );

        cardPayment.account = sender;
        cardPayment.amount = amount;

        cardPayment.status = PaymentStatus.Uncleared;

        IERC20Upgradeable(token).transferFrom(
            sender,
            address(this),
            amount
        );

        _unclearedBalances[sender] = _unclearedBalances[sender].add(amount);
        _totalUnclearedBalance = _totalUnclearedBalance.add(amount);

        emit CardPay(clientTransactionId, sender, amount);
    }

    /**
     * @dev Executes a clearing operation for a previously initiated card payment.
     * The payment should be uncleared.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {CardPaymentClear} event.
     * @param clientTransactionId The card client transaction ID from the off-chain Issuing operation backend.
     */
    function cardPaymentClear(bytes16 clientTransactionId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        CardPayment storage cardPayment = _cardPayments[clientTransactionId];
        address account = cardPayment.account;
        uint256 amount = cardPayment.amount;

        checkUnclearedStatus(cardPayment.status);

        cardPayment.status = PaymentStatus.Cleared;

        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "IssuingCashier: amount to clear greater than the uncleared balance"
        );
        _totalUnclearedBalance = _totalUnclearedBalance.sub(amount);

        _clearedBalances[account] = _clearedBalances[account].add(amount);
        _totalClearedBalance = _totalClearedBalance.add(amount);

        emit CardPaymentClear(
            clientTransactionId,
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    /**
     * @dev Cancels a previously executed clearing operation for a card payment.
     * The payment should be cleared.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {CardPaymentUnClear} event.
     * @param clientTransactionId The card client transaction ID from the off-chain Issuing operation backend.
     */
    function cardPaymentUnclear(bytes16 clientTransactionId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        CardPayment storage cardPayment = _cardPayments[clientTransactionId];
        address account = cardPayment.account;
        uint256 amount = cardPayment.amount;

        checkClearedStatus(cardPayment.status);

        cardPayment.status = PaymentStatus.Uncleared;

        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "IssuingCashier: amount to unclear greater than the cleared balance"
        );
        _totalClearedBalance = _totalClearedBalance.sub(amount);

        _unclearedBalances[account] = _unclearedBalances[account].add(amount);
        _totalUnclearedBalance = _totalUnclearedBalance.add(amount);

        emit CardPaymentUnclear(
            clientTransactionId,
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    /**
     * @dev Performs the reverse of a previously initiated card payment.
     * Finishes the payment and transfers tokens back from this contract to the payment initiator account.
     * The payment should be uncleared.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {CardPaymentReverse} event.
     * @param clientTransactionId The card client transaction ID from the off-chain Issuing operation backend.
     */
    function cardPaymentReverse(bytes16 clientTransactionId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        CardPayment storage cardPayment = _cardPayments[clientTransactionId];
        address account = cardPayment.account;
        uint256 amount = cardPayment.amount;

        checkUnclearedStatus(cardPayment.status);

        cardPayment.status = PaymentStatus.Reversed;

        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "IssuingCashier: card payment reversing amount exceeds the uncleared balance"
        );
        _totalUnclearedBalance = _totalUnclearedBalance.sub(amount);

        IERC20Upgradeable(token).transfer(account, amount);

        emit CardPaymentReverse(
            clientTransactionId,
            account,
            amount,
            _unclearedBalances[account]
        );
    }

    /**
     * @dev Executes the final step of card payment after clearing.
     * Finishes the payment and burns tokens previously gotten from the payment initiator account.
     * The payment should be cleared.
     * Can only be called when the contract is not paused.
     * Can only be called by whitelisted address.
     * Emits a {ClearConfirm} event.
     * @param clientTransactionId The card client transaction ID from the off-chain Issuing operation backend.
     */
    function clearConfirm(bytes16 clientTransactionId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        CardPayment storage cardPayment = _cardPayments[clientTransactionId];
        address account = cardPayment.account;
        uint256 amount = cardPayment.amount;

        checkClearedStatus(cardPayment.status);

        cardPayment.status = PaymentStatus.Confirmed;

        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "IssuingCashier: card payment confirming amount exceeds the cleared balance"
        );
        _totalClearedBalance = _totalClearedBalance.sub(amount);

        IERC20Mintable(token).burn(amount);

        emit ClearConfirm(
            clientTransactionId,
            account,
            amount,
            _clearedBalances[account]
        );
    }

    function checkClearedStatus(PaymentStatus status) internal pure {
        require(
            status != PaymentStatus.Inexistent,
            "IssuingCashier: card payment with provided ID does not exist"
        );
        require(
            status != PaymentStatus.Uncleared,
            "IssuingCashier: card payment with provided ID is uncleared"
        );
        require(
            status == PaymentStatus.Cleared,
            "IssuingCashier: card payment with provided ID is already reversed or confirmed"
        );
    }


    function checkUnclearedStatus(PaymentStatus status) internal pure {
        require(
            status != PaymentStatus.Inexistent,
            "IssuingCashier: card payment with provided ID does not exist"
        );
        require(
            status != PaymentStatus.Cleared,
            "IssuingCashier: card payment with provided ID is cleared"
        );
        require(
            status == PaymentStatus.Uncleared,
            "IssuingCashier: card payment with provided ID is already reversed or confirmed"
        );
    }
}
