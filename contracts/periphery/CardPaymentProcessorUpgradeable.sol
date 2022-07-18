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
 * @title CardPaymentProcessorUpgradeable contract
 * @dev Wrapper for the card payment operations.
 */
contract CardPaymentProcessorUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;

    event MakePayment(
        bytes16 indexed authorizationId,
        bytes16 indexed correlationId,
        address indexed account,
        uint256 amount
    );

    event ClearPayment(
        bytes16 indexed authorizationId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event UnclearPayment(
        bytes16 indexed authorizationId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance
    );

    event ReversePayment(
        bytes16 indexed authorizationId,
        bytes16 indexed correlationId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance,
        uint256 unclearedBalance,
        bool    wasPaymentCleared,
        bytes32 parentTransactionHash
    );

    event ConfirmPayment(
        bytes16 indexed authorizationId,
        address indexed account,
        uint256 amount,
        uint256 clearedBalance
    );

    enum PaymentStatus {
        Nonexistent, // 0
        Uncleared,   // 1
        Cleared,     // 2
        Confirmed,   // 3
        Reversed     // 4
    }

    struct Payment {
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
    mapping(bytes16 => Payment) private _payments;
    mapping(bytes32 => bool) private _paymentReverseFlags;

    function initialize(address token_) public initializer {
        __CardPaymentProcessor_init(token_);
    }

    function __CardPaymentProcessor_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __CardPaymentProcessor_init_unchained(token_);
    }

    function __CardPaymentProcessor_init_unchained(address token_) internal initializer {
        token = token_;
    }

    /**
     * @dev Returns the total uncleared amount of tokens locked in the contract.
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
     * @dev Returns the total cleared amount of tokens locked in the contract.
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
     * @param account The address of the account.
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
     * @param account The address of the account.
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
     * @dev Returns payment data for a card transaction authorization ID.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     * @return account The address of an account that made the card payment.
     * @return amount The amount of tokens for the payment.
     * @return status The current status of the payment according to the appropriate enum.
     */
    function paymentFor(bytes16 authorizationId)
        external
        view
        virtual
        returns (
            address account,
            uint256 amount,
            PaymentStatus status
        )
    {
        Payment storage payment = _payments[authorizationId];
        account = payment.account;
        amount = payment.amount;
        status = payment.status;
    }

    /**
     * @dev Checks if a payment related to a parent transaction hash has been reversed.
     * @param parentTxHash The hash of the transaction where the payment was made.
     */
    function isPaymentReversed(bytes32 parentTxHash)
        external
        view
        virtual
        returns (bool)
    {
        return _paymentReverseFlags[parentTxHash];
    }

    /**
     * @dev Makes a card payment.
     * Transfers the underlying tokens from the payer (who is the caller of the function) to this contract.
     * Can only be called when the contract is not paused.
     * Emits a {MakePayment} event.
     * @param amount The amount of tokens to be transferred to this contract because of the payment.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     * @param correlationId The ID that is correlated to call of this function in the off-chain card processing backend.
     */
    function makePayment(
        uint256 amount,
        bytes16 authorizationId,
        bytes16 correlationId
    ) external whenNotPaused {
        Payment storage payment = _payments[authorizationId];
        address sender = _msgSender();

        require(
            amount > 0,
            "CardPaymentProcessor: payment amount must be greater than 0"
        );

        require(
            authorizationId != 0,
            "CardPaymentProcessor: authorization ID must not equal 0"
        );

        require(
            payment.status == PaymentStatus.Nonexistent,
            "CardPaymentProcessor: payment with the provided authorization ID already exists"
        );

        payment.account = sender;
        payment.amount = amount;
        payment.status = PaymentStatus.Uncleared;

        IERC20Upgradeable(token).transferFrom(
            sender,
            address(this),
            amount
        );

        _unclearedBalances[sender] = _unclearedBalances[sender].add(amount);
        _totalUnclearedBalance = _totalUnclearedBalance.add(amount);

        emit MakePayment(
            authorizationId,
            correlationId,
            sender,
            amount
        );
    }

    /**
 * @dev Executes a clearing operation for a single previously made card payment.
     * The payment should have the "uncleared" status or the call will be reverted.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {ClearPayment} event for the payment.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     */
    function clearPayment(bytes16 authorizationId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        uint256 amount = clearPaymentInternal(authorizationId);

        // We can use unsafe '-' operation here instead of '.sub()' because the balance is fine in the operation above
        _totalUnclearedBalance = _totalUnclearedBalance - amount;
        _totalClearedBalance = _totalClearedBalance.add(amount);
    }

    /**
     * @dev Executes a clearing operation for several previously made card payments.
     * Each payment should have the "uncleared" status or the call will be reverted.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {ClearPayment} event for each payment.
     * @param authorizationIds The card transaction authorization IDs from the off-chain card processing backend.
     */
    function clearPayments(bytes16[] memory authorizationIds)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            authorizationIds.length != 0,
            "CardPaymentProcessor: input array of authorization IDs is empty"
        );

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < authorizationIds.length; i++) {
            totalAmount = totalAmount.add(clearPaymentInternal(authorizationIds[i]));
        }
        // We can use unsafe '-' operation here instead of '.sub()' because all balances are fine in the cycle above
        _totalUnclearedBalance = _totalUnclearedBalance - totalAmount;
        _totalClearedBalance = _totalClearedBalance.add(totalAmount);
    }

    /**
     * @dev Cancels a previously executed clearing operation for a single card payment.
     * The payment should have the "cleared" status or the call will be reverted.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {UnclearPayment} event for the payment.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     */
    function unclearPayment(bytes16 authorizationId)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        uint256 amount = unclearPaymentInternal(authorizationId);

        // We can use unsafe '-' operation here instead of '.sub()' because the balance is fine in the operation above
        _totalClearedBalance = _totalClearedBalance - amount;
        _totalUnclearedBalance = _totalUnclearedBalance.add(amount);
    }

    /**
     * @dev Cancels a previously executed clearing operation for several card payments.
     * Each payment should have the "cleared" status or the call will be reverted.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {UnclearPayment} event for each payment.
     * @param authorizationIds The card transaction authorization IDs from the off-chain card processing backend.
     */
    function unclearPayments(bytes16[] memory authorizationIds)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            authorizationIds.length != 0,
            "CardPaymentProcessor: input array of authorization IDs is empty"
        );
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < authorizationIds.length; i++) {
            totalAmount = totalAmount.add(unclearPaymentInternal(authorizationIds[i]));
        }
        // We can use unsafe '-' operation here instead of '.sub()' because all balances are fine in the cycle above
        _totalClearedBalance = _totalClearedBalance - totalAmount;
        _totalUnclearedBalance = _totalUnclearedBalance.add(totalAmount);
    }

    /**
     * @dev Performs the reverse of a previously made card payment.
     * Finalizes the payment and transfers tokens back from this contract to the payer.
     * The payment should have "cleared" or "uncleared" statuses. Otherwise the call will be reverted.
     * Can only be called by a whitelisted address.
     * Can only be called when the contract is not paused.
     * Emits a {ReversePayment} event.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     * @param correlationId The ID that is correlated to call of this function in the off-chain card processing backend.
     * @param parentTxHash The hash of the transaction where the payment was made.
     */
    function reversePayment(
        bytes16 authorizationId,
        bytes16 correlationId,
        bytes32 parentTxHash
    )
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            authorizationId != 0,
            "CardPaymentProcessor: authorization ID must not equal 0"
        );
        require(
            parentTxHash != 0,
            "CardPaymentProcessor: parent transaction hash should not equal 0"
        );

        Payment storage payment = _payments[authorizationId];
        PaymentStatus status = payment.status;

        require(
            status != PaymentStatus.Nonexistent,
            "CardPaymentProcessor: payment with the provided authorization ID does not exist"
        );

        address account = payment.account;
        uint256 amount = payment.amount;

        if (status == PaymentStatus.Uncleared) {
            _unclearedBalances[account] = _unclearedBalances[account].sub(
                amount,
                "CardPaymentProcessor: payment reversing amount exceeds the uncleared balance of an account"
            );
            _totalUnclearedBalance = _totalUnclearedBalance.sub(amount);
        } else if (status == PaymentStatus.Cleared) {
            _clearedBalances[account] = _clearedBalances[account].sub(
                amount,
                "CardPaymentProcessor: payment reversing amount exceeds the cleared balance of an account"
            );
            _totalClearedBalance = _totalClearedBalance.sub(amount);
        } else {
            revert("CardPaymentProcessor: payment with the provided authorization ID is already reversed or confirmed");
        }

        payment.status = PaymentStatus.Reversed;
        _paymentReverseFlags[parentTxHash] = true;

        IERC20Upgradeable(token).transfer(account, amount);

        emit ReversePayment(
            authorizationId,
            correlationId,
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account],
            status == PaymentStatus.Cleared,
            parentTxHash
        );
    }

    /**
     * @dev Executes the final step of single card payments processing with token transferring.
     * Finalizes the payment and transfers previously cleared tokens gotten from a payer
     * to a dedicated cash-out account for further operations.
     * The payment should have the "cleared" status or the call will be reverted.
     * Can only be called when the contract is not paused.
     * Can only be called by whitelisted address.
     * Emits a {ConfirmPayment} event for the payment.
     * @param authorizationId The card transaction authorization ID from the off-chain card processing backend.
     * @param cashOutAccount The account to transfer cleared tokens to.
     */
    function confirmPayment(bytes16 authorizationId, address cashOutAccount)
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        uint256 amount = confirmPaymentInternal(authorizationId);
        // We can use unsafe '-' operation here instead of '.sub()' because the balance is fine in the operation above
        _totalClearedBalance = _totalClearedBalance - amount;
        IERC20Upgradeable(token).transfer(cashOutAccount, amount);
    }

    /**
 * @dev Executes the final step of several card payments processing with token transferring.
     * Finalizes the payments and transfers previously cleared tokens gotten from payers
     * to a dedicated cash-out account for further operations.
     * Each payment should have the "cleared" status or the call will be reverted.
     * Can only be called when the contract is not paused.
     * Can only be called by whitelisted address.
     * Emits a {ConfirmPayment} event for each payment.
     * @param authorizationIds The card transaction authorization IDs from the off-chain card processing backend.
     * @param cashOutAccount The account to transfer cleared tokens to.
     */
    function confirmPayments(
        bytes16[] memory authorizationIds,
        address cashOutAccount
    )
        external
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            authorizationIds.length != 0,
            "CardPaymentProcessor: input array of authorization IDs is empty"
        );

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < authorizationIds.length; i++) {
            totalAmount = totalAmount.add(confirmPaymentInternal(authorizationIds[i]));
        }
        // We can use unsafe '-' operation here instead of '.sub()' because all balances are fine in the cycle above
        _totalClearedBalance = _totalClearedBalance - totalAmount;

        IERC20Upgradeable(token).transfer(cashOutAccount, totalAmount);
    }

    function clearPaymentInternal(bytes16 authorizationId) internal returns (uint256 amount){
        require(
            authorizationId != 0,
            "CardPaymentProcessor: authorization ID must not equal 0"
        );

        Payment storage payment = _payments[authorizationId];

        checkUnclearedStatus(payment.status);
        payment.status = PaymentStatus.Cleared;

        address account = payment.account;
        amount = payment.amount;

        _unclearedBalances[account] = _unclearedBalances[account].sub(
            amount,
            "CardPaymentProcessor: amount to clear greater than the uncleared balance"
        );
        _clearedBalances[account] = _clearedBalances[account].add(amount);

        emit ClearPayment(
            authorizationId,
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    function unclearPaymentInternal(bytes16 authorizationId) internal returns (uint256 amount) {
        require(
            authorizationId != 0,
            "CardPaymentProcessor: authorization ID must not equal 0"
        );

        Payment storage payment = _payments[authorizationId];

        checkClearedStatus(payment.status);
        payment.status = PaymentStatus.Uncleared;

        address account = payment.account;
        amount = payment.amount;

        _clearedBalances[account] = _clearedBalances[account].sub(
            amount,
            "CardPaymentProcessor: amount to unclear greater than the cleared balance of an account"
        );
        _unclearedBalances[account] = _unclearedBalances[account].add(amount);

        emit UnclearPayment(
            authorizationId,
            account,
            amount,
            _clearedBalances[account],
            _unclearedBalances[account]
        );
    }

    function confirmPaymentInternal(bytes16 authorizationId) internal returns (uint256 amount) {
        require(
            authorizationId != 0,
            "CardPaymentProcessor: authorization ID must not equal 0"
        );

        Payment storage payment = _payments[authorizationId];

        checkClearedStatus(payment.status);
        payment.status = PaymentStatus.Confirmed;

        address account = payment.account;
        amount = payment.amount;
        uint256 newBalance = _clearedBalances[account].sub(
            amount,
            "CardPaymentProcessor: payment confirming amount exceeds the cleared balance of an account"
        );
        _clearedBalances[account] = newBalance;

        emit ConfirmPayment(
            authorizationId,
            account,
            amount,
            newBalance
        );
    }

    function checkClearedStatus(PaymentStatus status) internal pure {
        require(
            status != PaymentStatus.Nonexistent,
            "CardPaymentProcessor: payment with the provided authorization ID does not exist"
        );
        require(
            status != PaymentStatus.Uncleared,
            "CardPaymentProcessor: payment with the provided authorization ID is uncleared"
        );
        require(
            status == PaymentStatus.Cleared,
            "CardPaymentProcessor: payment with the provided authorization ID is already reversed or confirmed"
        );
    }

    function checkUnclearedStatus(PaymentStatus status) internal pure {
        require(
            status != PaymentStatus.Nonexistent,
            "CardPaymentProcessor: payment with the provided authorization ID does not exist"
        );
        require(
            status != PaymentStatus.Cleared,
            "CardPaymentProcessor: payment with the provided authorization ID is cleared"
        );
        require(
            status == PaymentStatus.Uncleared,
            "CardPaymentProcessor: payment with the provided authorization ID is already reversed or confirmed"
        );
    }
}
