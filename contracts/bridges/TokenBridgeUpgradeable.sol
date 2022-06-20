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

    event SetRelocationChain(uint256 indexed chainId, bool supported);
    event SetArrivalChain(uint256 indexed chainId, bool supported);
    event RegisterRelocation(
        uint256 indexed nonce,
        uint256 indexed chainId,
        address indexed account,
        uint256 amount
    );
    event CancelRelocation(
        uint256 indexed nonce,
        uint256 indexed chainId,
        address indexed account,
        uint256 amount
    );
    event ConfirmRelocation(
        uint256 indexed nonce,
        uint256 indexed chainId,
        address indexed account,
        uint256 amount
    );
    event ConfirmArrival(
        uint256 indexed nonce,
        uint256 indexed chainId,
        address indexed account,
        uint256 amount
    );

    struct Relocation {
        uint256 chainId;
        address account;
        uint256 amount;
        bool canceled;
    }

    address public token;

    uint256 public pendingRelocations;
    uint256 public lastConfirmedRelocationNonce;
    mapping(uint256 => bool) public relocationChains;
    mapping(uint256 => Relocation) public relocations;

    mapping(uint256 => bool) public arrivalChains;
    mapping(uint256 => uint256) public arrivalNonces;

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

    function registerRelocation(uint256 chainId, uint256 amount)
        external
        whenNotPaused
        returns (uint256 nonce)
    {
        require(
            relocationChains[chainId],
            "TokenBridge: relocation chain is not supported"
        );
        require(
            amount > 0,
            "TokenBridge: relocation amount must be greater than 0"
        );

        pendingRelocations = pendingRelocations.add(1);
        nonce = lastConfirmedRelocationNonce.add(pendingRelocations);
        Relocation storage relocation = relocations[nonce];
        relocation.account = _msgSender();
        relocation.chainId = chainId;
        relocation.amount = amount;

        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        emit RegisterRelocation(nonce, chainId, _msgSender(), amount);
    }

    function cancelRelocation(uint256 nonce) public whenNotPaused {
        require(
            relocations[nonce].account == _msgSender(),
            "TokenBridge: transaction sender is not authorized"
        );

        cancelRelocationInternal(nonce);
    }

    function cancelRelocations(uint256[] memory nonces)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            nonces.length != 0,
            "TokenBridge: relocation nonces array is empty"
        );

        for (uint256 i = 0; i < nonces.length; i++) {
            cancelRelocationInternal(nonces[i]);
        }
    }

    function cancelRelocationInternal(uint256 nonce) internal {
        require(
            nonce > lastConfirmedRelocationNonce,
            "TokenBridge: relocation with the nonce already processed"
        );
        require(
            nonce <= lastConfirmedRelocationNonce.add(pendingRelocations),
            "TokenBridge: relocation with the nonce doesn't exist"
        );

        Relocation storage relocation = relocations[nonce];

        require(
            !relocation.canceled,
            "TokenBridge: relocation was already canceled"
        );

        relocation.canceled = true;
        IERC20Upgradeable(token).transfer(
            relocation.account,
            relocation.amount
        );

        emit CancelRelocation(
            nonce,
            relocation.chainId,
            relocation.account,
            relocation.amount
        );
    }

    function relocate(uint256 count)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            pendingRelocations <= count,
            "TokenBridge: the count exceeds the number of pending relocations"
        );

        uint256 fromNonce = lastConfirmedRelocationNonce.add(1);
        uint256 toNonce = lastConfirmedRelocationNonce.add(count);

        pendingRelocations = pendingRelocations.sub(count);
        lastConfirmedRelocationNonce = lastConfirmedRelocationNonce.add(count);

        for (uint256 i = fromNonce; i <= toNonce; i++) {
            Relocation memory relocation = relocations[i];
            if (!relocation.canceled) {
                IERC20Mintable(token).burn(relocation.amount);
                emit ConfirmRelocation(
                    i,
                    relocation.chainId,
                    relocation.account,
                    relocation.amount
                );
            }
        }
    }

    function accommodate(
        uint256 chainId,
        uint256[] memory nonces,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory canceled
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            arrivalChains[chainId],
            "TokenBridge: arrival chain is not supported"
        );
        require(
            nonces.length != 0 &&
                nonces.length == accounts.length &&
                accounts.length == amounts.length &&
                amounts.length == canceled.length,
            "TokenBridge: input arrays error"
        );

        uint256 nonce = arrivalNonces[chainId];

        for (uint256 i = 0; i < nonces.length; i++) {
            nonce = nonce.add(1);
            require(
                nonces[i] == nonce,
                "TokenBridge: relocation nonce mismatch"
            );
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
                emit ConfirmArrival(
                    nonces[i],
                    chainId,
                    accounts[i],
                    amounts[i]
                );
            }
        }

        arrivalNonces[chainId] = nonce;
    }

    function setRelocationChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        relocationChains[chainId] = supported;
        emit setRelocationChain(chainId, supported);
    }

    function setArrivalChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        arrivalChains[chainId] = supported;
        emit SetArrivalChain(chainId, supported);
    }
}
