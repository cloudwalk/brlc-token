// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import {IERC20Mintable} from "../base/interfaces/IERC20Mintable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";

contract TokenBridgeUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;

    event RegisterDeposit(
        uint256 indexed nonce,
        address indexed account,
        uint256 indexed chainId,
        uint256 amount
    );
    event CancelDeposit(
        uint256 indexed nonce,
        address indexed account,
        uint256 indexed chainId,
        uint256 amount
    );
    event ConfirmBurn(
        uint256 indexed depositNonce,
        address indexed account,
        uint256 indexed chainId,
        uint256 amount
    );
    event ConfirmMint(
        uint256 indexed depositNonce,
        address indexed account,
        uint256 amount
    );

    struct Deposit {
        address account;
        uint256 chainId;
        uint256 amount;
        bool canceled;
    }

    address public token;
    uint256 public burnNonce;
    uint256 public mintNonce;
    uint256 public pendingDeposits;
    mapping(uint256 => bool) public chains;
    mapping(uint256 => Deposit) public deposits;

    function initialize(address _token) public initializer {
        __TokenBridge_init(_token);
    }

    function __TokenBridge_init(address _token) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __TokenBridge_init_unchained(_token);
    }

    function __TokenBridge_init_unchained(address _token) internal initializer {
        token = _token;
    }

    function registerDeposit(uint256 chainId, uint256 amount)
        external
        whenNotPaused
        returns (uint256 depositNonce)
    {
        require(chains[chainId], "TokenBridge: chain is not supported");
        require(amount > 0, "TokenBridge: amount must be greater than 0");

        pendingDeposits = pendingDeposits.add(1);
        depositNonce = burnNonce.add(pendingDeposits);
        Deposit storage deposit = deposits[depositNonce];
        deposit.account = _msgSender();
        deposit.chainId = chainId;
        deposit.amount = amount;

        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        emit RegisterDeposit(depositNonce, _msgSender(), chainId, amount);
    }

    function cancelDeposit(uint256 depositNonce) public whenNotPaused {
        require(
            deposits[depositNonce].account == _msgSender(),
            "TokenBridge: sender not authorized"
        );

        cancelDepositInternal(depositNonce);
    }

    function cancelDeposits(uint256[] memory depositNonces)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            depositNonces.length != 0,
            "TokenBridge: deposit nonces array is empty"
        );

        for (uint256 i = 0; i < depositNonces.length; i++) {
            cancelDepositInternal(depositNonces[i]);
        }
    }

    function cancelDepositInternal(uint256 depositNonce) internal {
        require(
            depositNonce > burnNonce,
            "TokenBridge: deposit already processed"
        );
        require(
            depositNonce <= burnNonce.add(pendingDeposits),
            "TokenBridge: deposit nonce doesn't exist"
        );

        Deposit storage deposit = deposits[depositNonce];

        require(!deposit.canceled, "TokenBridge: deposit already canceled");

        deposit.canceled = true;
        IERC20Upgradeable(token).transfer(deposit.account, deposit.amount);

        emit CancelDeposit(
            depositNonce,
            deposit.account,
            deposit.chainId,
            deposit.amount
        );
    }

    function burn(uint256 count)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(pendingDeposits <= count, "TokenBridge: burns count overflow");

        pendingDeposits = pendingDeposits.sub(count);
        burnNonce = burnNonce.add(count);

        uint256 fromNonce = burnNonce.add(1);
        uint256 toNonce = burnNonce.add(count);

        for (uint256 i = fromNonce; i <= toNonce; i++) {
            Deposit memory deposit = deposits[i];
            if (!deposit.canceled) {
                IERC20Mintable(token).burn(deposit.amount);
                emit ConfirmBurn(
                    i,
                    deposit.account,
                    deposit.chainId,
                    deposit.amount
                );
            }
        }
    }

    function mint(
        uint256[] memory nonces,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory canceled
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(nonces.length != 0, "TokenBridge: nonces array is empty");
        require(
            nonces.length == accounts.length &&
                accounts.length == amounts.length &&
                amounts.length == canceled.length,
            "TokenBridge: array length mismatch"
        );

        uint256 nonce = mintNonce;

        for (uint256 i = 0; i < nonces.length; i++) {
            nonce = nonce.add(1);
            require(nonces[i] == nonce, "TokenBridge: mint nonce mismatch");
            require(
                accounts[i] != address(0),
                "TokenBridge: account is the zero address"
            );
            require(
                amounts[i] != 0,
                "TokenBridge: amount must be greater than 0"
            );
            if (!canceled[i]) {
                IERC20Mintable(token).mint(accounts[i], amounts[i]);
                emit ConfirmMint(nonces[i], accounts[i], amounts[i]);
            }
        }

        mintNonce = nonce;
    }

    function setChain(uint256 chainId, bool enabled) external onlyOwner {
        chains[chainId] = enabled;
    }
}
