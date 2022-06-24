// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import {IERC20Bridgeable} from "../base/interfaces/IERC20Bridgeable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";

/**
 * @title TokenBridgeUpgradeable contract
 */
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

    /// @dev The address of the underlying token.
    address public token;

    /// @dev The number of pending relocation requests.
    uint256 public pendingRelocations;

    /// @dev The nonce of the last confirmed relocation requests.
    uint256 public lastConfirmedRelocationNonce;

    /// @dev The mapping of supported networks to relocate to.
    mapping(uint256 => bool) public relocationChains;

    /// @dev The mapping of registered relocation requests.
    mapping(uint256 => Relocation) public relocations;

    /// @dev The mapping of supported networks to arrive from.
    mapping(uint256 => bool) public arrivalChains;

    /// @dev The mapping of nonces for accommodated relocation requests.
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

    /**
     * @dev Registers a new relocation request with transferring tokens from an account to the bridge.
     * Can only be called when the contract is not paused.
     * @param chainId The ID of the destination network.
     * @param amount Amount of tokens that will be relocated.
     * @return nonce The nonce of the relocation request.
     */
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
        require(
            IERC20Bridgeable(token).bridge() == address(this),
            "TokenBridge: registration failed due to this bridge is not supported by the token contract"
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

    /**
     * @dev Cancels the relocation request with transferring tokens back from the bridge to the account.
     * Can only be called when the contract is not paused.
     * @param nonce The nonce of the relocation request to cancel.
     */
    function cancelRelocation(uint256 nonce) public whenNotPaused {
        require(
            relocations[nonce].account == _msgSender(),
            "TokenBridge: transaction sender is not authorized"
        );

        cancelRelocationInternal(nonce);
    }

    /**
     * @dev Cancels multiple relocation requests with transferring tokens back from the bridge to the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param nonces The array of relocation request nonces to cancel.
     */
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

    /**
     * @dev Completes pending relocation requests with burning of tokens previously received from accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param count The number of pending relocation requests to complete.
     */
    function relocate(uint256 count)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            count > 0,
            "TokenBridge: the count should be greater than zero"
        );
        require(
            count <= pendingRelocations,
            "TokenBridge: the count exceeds the number of pending relocations"
        );
        require(
            IERC20Bridgeable(token).bridge() == address(this),
            "TokenBridge: relocation failed due to this bridge is not supported by the token contract"
        );

        uint256 fromNonce = lastConfirmedRelocationNonce.add(1);
        uint256 toNonce = lastConfirmedRelocationNonce.add(count);

        pendingRelocations = pendingRelocations.sub(count);
        lastConfirmedRelocationNonce = lastConfirmedRelocationNonce.add(count);

        for (uint256 i = fromNonce; i <= toNonce; i++) {
            Relocation memory relocation = relocations[i];
            if (!relocation.canceled) {
                require(
                    IERC20Bridgeable(token).burnForBridging(
                        relocation.account,
                        relocation.amount
                    ),
                    "TokenBridge: burning of tokens failed"
                );
                emit ConfirmRelocation(
                    i,
                    relocation.chainId,
                    relocation.account,
                    relocation.amount
                );
            }
        }
    }

    /**
     * @dev Accommodates new relocation requests with token minting for the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The ID of the source network.
     * @param nonces The array of relocation nonces to accommodate.
     * @param accounts The array of accounts to accommodate.
     * @param amounts The array of token amounts to accommodate.
     */
    function accommodate(
        uint256 chainId,
        uint256[] memory nonces,
        address[] memory accounts,
        uint256[] memory amounts
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            arrivalChains[chainId],
            "TokenBridge: arrival chain is not supported"
        );
        require(
            nonces.length != 0 &&
                nonces.length == accounts.length &&
                accounts.length == amounts.length,
            "TokenBridge: input arrays error"
        );
        require(
            IERC20Bridgeable(token).bridge() == address(this),
            "TokenBridge: accommodation failed due to this bridge is not supported by the token contract"
        );

        uint256 nonce = arrivalNonces[chainId];

        for (uint256 i = 0; i < nonces.length; i++) {
            require(
                nonces[i] > nonce,
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
            nonce = nonces[i];
            require(
                IERC20Bridgeable(token).mintForBridging(
                    accounts[i],
                    amounts[i]
                ),
                "TokenBridge: minting of tokens failed"
            );
            emit ConfirmArrival(nonces[i], chainId, accounts[i], amounts[i]);
        }

        arrivalNonces[chainId] = nonce;
    }

    /**
     * @dev Sets the relocation network supporting.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination network to relocate.
     * @param supported True if the destination network is supported to relocate.
     */
    function setRelocationChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        relocationChains[chainId] = supported;
        emit SetRelocationChain(chainId, supported);
    }

    /**
     * @dev Sets the arrival network supporting.
     * Can only be called by the current owner.
     * @param chainId The ID of the foreign network to arrive from.
     * @param supported True if the foreign network is supported to arrive from.
     */
    function setArrivalChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        arrivalChains[chainId] = supported;
        emit SetArrivalChain(chainId, supported);
    }
}
