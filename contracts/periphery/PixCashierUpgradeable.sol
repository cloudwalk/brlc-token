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
 * @dev Wrapper for Pix cash-in and cash-out transactions.
 */
contract PixCashierUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;

    address public token;
    mapping(address => uint256) private _cashOutBalances;

    event CashIn(
        address indexed account,
        uint256 amount,
        bytes32 indexed txId
    );
    event CashOut(
        address indexed account,
        uint256 amount,
        uint256 balance,
        bytes32 indexed txId
    );
    event CashOutConfirm(
        address indexed account,
        uint256 amount,
        uint256 balance,
        bytes32 indexed txId
    );
    event CashOutReverse(
        address indexed account,
        uint256 amount,
        uint256 balance,
        bytes32 indexed txId
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
     * @dev Returns the cash-out balance.
     * @param account The address of a tokens owner.
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
     * @dev Executes a cash-in transaction and mocks tx id.
     * @param account An address that will receive tokens.
     * @param amount The amount of tokens to be minted.
     */
    function cashIn(address account, uint256 amount) external {
        cashIn(account, amount, "MOCK_TRANSACTION_ID");
    }

    /**
     * @dev Executes a cash-in transaction.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * Emits a {CashIn} event.
     * @param account An address that will receive tokens.
     * @param amount The amount of tokens to be minted.
     * @param txId The off-chain transaction identifier.
     */
    function cashIn(
        address account,
        uint256 amount,
        bytes32 txId
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            txId != 0,
            "PixCashier: transaction id must be provided"
        );
        IERC20Mintable(token).mint(account, amount);
        emit CashIn(account, amount, txId);
    }

    /**
     * @dev Initiates a cash-out transaction and mocks tx id.
     * @param amount The amount of tokens to be transferred to the contract.
     */
    function cashOut(uint256 amount) external {
        cashOut(amount, "MOCK_TRANSACTION_ID");
    }

    /**
     * @dev Initiates a cash-out transaction.
     * Can only be called when the contract is not paused.
     * Emits a {CashOut} event.
     * @param amount The amount of tokens to be transferred to the contract.
     * @param txId The off-chain transaction identifier.
     */
    function cashOut(uint256 amount, bytes32 txId) public whenNotPaused {
        require(
            txId != 0,
            "PixCashier: transaction id must be provided"
        );
        IERC20Upgradeable(token).transferFrom(
            _msgSender(),
            address(this),
            amount
        );
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].add(
            amount
        );
        emit CashOut(
            _msgSender(),
            amount,
            _cashOutBalances[_msgSender()],
            txId
        );
    }

    /**
     * @dev Confirms a cash-out transaction and mocks tx id.
     * @param amount The amount of tokens to be burned.
     */
    function cashOutConfirm(uint256 amount) external {
        cashOutConfirm(amount, "MOCK_TRANSACTION_ID");
    }

    /**
     * @dev Confirms a cash-out transaction.
     * Can only be called when the contract is not paused.
     * Emits a {CashOutConfirm} event.
     * @param amount The amount of tokens to be burned.
     * @param txId The off-chain transaction identifier.
     */
    function cashOutConfirm(uint256 amount, bytes32 txId)
        public
        whenNotPaused
    {
        require(
            txId != 0,
            "PixCashier: transaction id must be provided"
        );
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].sub(
            amount,
            "PixCashier: cash-out confirm amount exceeds balance"
        );
        IERC20Mintable(token).burn(amount);
        emit CashOutConfirm(
            _msgSender(),
            amount,
            _cashOutBalances[_msgSender()],
            txId
        );
    }

    /**
     * @dev Reverts a cash-out transaction and mocks tx id.
     * @param amount The amount of tokens to be transferred back to the sender.
     */
    function cashOutReverse(uint256 amount) external {
        cashOutReverse(amount, "MOCK_TRANSACTION_ID");
    }

    /**
     * @dev Reverts a cash-out transaction.
     * Can only be called when the contract is not paused.
     * Emits a {CashOutReverse} event.
     * @param amount The amount of tokens to be transferred back to the sender.
     * @param txId The off-chain transaction identifier.
     */
    function cashOutReverse(uint256 amount, bytes32 txId)
        public
        whenNotPaused
    {
        require(
            txId != 0,
            "PixCashier: transaction id must be provided"
        );
        _cashOutBalances[_msgSender()] = _cashOutBalances[_msgSender()].sub(
            amount,
            "PixCashier: cash-out reverse amount exceeds balance"
        );
        IERC20Upgradeable(token).transfer(_msgSender(), amount);
        emit CashOutReverse(
            _msgSender(),
            amount,
            _cashOutBalances[_msgSender()],
            txId
        );
    }
}
