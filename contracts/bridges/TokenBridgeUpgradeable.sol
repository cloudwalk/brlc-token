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
    uint256 public arrivalNonce;
    uint256 public relocationNonce;
    uint256 public pendingRelocations;
    mapping(uint256 => bool) public supportedChains;
    mapping(uint256 => Relocation) public relocations;

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
            supportedChains[chainId],
            "TokenBridge: relocation chain is not supported"
        );
        require(
            amount > 0,
            "TokenBridge: relocation amount must be greater than 0"
        );

        pendingRelocations = pendingRelocations.add(1);
        nonce = relocationNonce.add(pendingRelocations);
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
            "TokenBridge: transaction sender not authorized"
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
            nonce > relocationNonce,
            "TokenBridge: relocation nonce already processed"
        );
        require(
            nonce <= relocationNonce.add(pendingRelocations),
            "TokenBridge: relocation nonce doesn't exist"
        );

        Relocation storage relocation = relocations[nonce];

        require(
            !relocation.canceled,
            "TokenBridge: relocation already canceled"
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
            "TokenBridge: pending relocations count overflow"
        );

        pendingRelocations = pendingRelocations.sub(count);
        relocationNonce = relocationNonce.add(count);

        uint256 fromNonce = relocationNonce.add(1);
        uint256 toNonce = relocationNonce.add(count);

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
        uint256[] memory nonces,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory canceled
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            nonces.length != 0 &&
                nonces.length == accounts.length &&
                accounts.length == amounts.length &&
                amounts.length == canceled.length,
            "TokenBridge: input arrays error"
        );

        uint256 nonce = arrivalNonce;

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
                emit ConfirmArrival(nonces[i], accounts[i], amounts[i]);
            }
        }

        arrivalNonce = nonce;
    }

    function setSupportedChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        supportedChains[chainId] = supported;
    }
}
