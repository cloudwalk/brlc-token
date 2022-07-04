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
 * @title MultiTokenBridgeUpgradeable contract
 */
contract MultiTokenBridgeUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;

    event SetRelocationChain(uint256 indexed chainId, bool supported);
    event SetArrivalChain(uint256 indexed chainId, bool supported);
    event RegisterRelocation(
        uint256 indexed chainId,
        uint256 indexed nonce,
        address indexed account,
        address token,
        uint256 amount
    );
    event CancelRelocation(
        uint256 indexed chainId,
        uint256 indexed nonce,
        address indexed account,
        address token,
        uint256 amount
    );
    event ConfirmRelocation(
        uint256 indexed chainId,
        uint256 indexed nonce,
        address indexed account,
        address token,
        uint256 amount
    );
    event ConfirmArrival(
        uint256 indexed chainId,
        uint256 indexed nonce,
        address indexed account,
        address token,
        uint256 amount
    );

    struct Relocation {
        address account;
        address token;
        uint256 amount;
        bool canceled;
    }

    /// @dev The mapping: a chain ID => the number of pending relocation requests to that chain.
    mapping (uint256 => uint256) public pendingRelocations;

    /// @dev The mapping: a chain ID => the nonce of the last confirmed relocation requests to that chain.
    mapping (uint256 => uint256) public lastConfirmedRelocationNonces;

    /// @dev The mapping: a chain ID => the supporting of relocation to that chain
    mapping(uint256 => bool) public relocationChains;

    /** @dev The mapping: a chain ID => the nested mapping corresponded to that chain ID.
     *  The nested mapping: a nonce => the relocation structure corresponded to that nonce.
     */
    mapping(uint256 => mapping(uint256 => Relocation)) public relocations;

    /// @dev The mapping: a chain ID => the supporting of arrival from that chain.
    mapping(uint256 => bool) public arrivalChains;

    /// @dev The mapping: a chain ID => the nonce of the last accommodated relocation request come from that chain.
    mapping(uint256 => uint256) public arrivalNonces;

    function initialize() public initializer {
        __MultiTokenBridge_init();
    }

    function __MultiTokenBridge_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __MultiTokenBridge_init_unchained();
    }

    function __MultiTokenBridge_init_unchained() internal initializer {}

    /**
     * @dev Registers a new relocation request with transferring tokens from an account to the bridge.
     * Can only be called when the contract is not paused.
     * @param chainId The ID of the destination chain.
     * @param token The address of the token contract which supports bridge operations.
     * @param amount Amount of tokens that will be relocated.
     * @return nonce The nonce of the relocation request.
     */
    function registerRelocation(uint256 chainId, address token, uint256 amount)
        external
        whenNotPaused
        returns (uint256 nonce)
    {
        require(
            relocationChains[chainId],
            "MultiTokenBridge: relocation chain is not supported"
        );
        require(
            amount > 0,
            "MultiTokenBridge: relocation amount must be greater than 0"
        );
        require(
            token != address(0),
            "MultiTokenBridge: token is the zero address"
        );
        require(
            IERC20Bridgeable(token).bridge() == address(this),
            "MultiTokenBridge: bridge is not supported by the token contract"
        );

        pendingRelocations[chainId] = pendingRelocations[chainId].add(1);
        nonce = lastConfirmedRelocationNonces[chainId].add(pendingRelocations[chainId]);
        Relocation storage relocation = relocations[chainId][nonce];
        relocation.account = _msgSender();
        relocation.token = token;
        relocation.amount = amount;

        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        emit RegisterRelocation(chainId, nonce, _msgSender(), token, amount);
    }

    /**
     * @dev Cancels the relocation request with transferring tokens back from the bridge to the account.
     * Can only be called when the contract is not paused.
     * @param chainId The chain ID of the relocation request to cancel.
     * @param nonce The nonce of the relocation request to cancel.
     */
    function cancelRelocation(uint256 chainId, uint256 nonce) public whenNotPaused {
        require(
            relocations[chainId][nonce].account == _msgSender(),
            "MultiTokenBridge: transaction sender is not authorized"
        );

        cancelRelocationInternal(chainId, nonce);
    }

    /**
     * @dev Cancels multiple relocation requests with transferring tokens back from the bridge to the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The chain ID of the relocation request to cancel.
     * @param nonces The array of relocation request nonces to cancel.
     */
    function cancelRelocations(uint256 chainId, uint256[] memory nonces)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            nonces.length != 0,
            "MultiTokenBridge: relocation nonces array is empty"
        );

        for (uint256 i = 0; i < nonces.length; i++) {
            cancelRelocationInternal(chainId, nonces[i]);
        }
    }

    function cancelRelocationInternal(uint256 chainId, uint256 nonce) internal {
        require(
            nonce > lastConfirmedRelocationNonces[chainId],
            "MultiTokenBridge: relocation with the nonce already processed"
        );
        require(
            nonce <= lastConfirmedRelocationNonces[chainId].add(pendingRelocations[chainId]),
            "MultiTokenBridge: relocation with the nonce does not exist"
        );

        Relocation storage relocation = relocations[chainId][nonce];

        require(
            !relocation.canceled,
            "MultiTokenBridge: relocation was already canceled"
        );

        relocation.canceled = true;
        IERC20Upgradeable(relocation.token).transfer(
            relocation.account,
            relocation.amount
        );

        emit CancelRelocation(
            chainId,
            nonce,
            relocation.account,
            relocation.token,
            relocation.amount
        );
    }

    /**
     * @dev Completes pending relocation requests with burning of tokens previously received from accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The chain ID of the relocation request to cancel.
     * @param count The number of pending relocation requests to complete.
     */
    function relocate(uint256 chainId, uint256 count)
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            count > 0,
            "MultiTokenBridge: count should be greater than zero"
        );
        require(
            count <= pendingRelocations[chainId],
            "MultiTokenBridge: count exceeds the number of pending relocations"
        );

        uint256 fromNonce = lastConfirmedRelocationNonces[chainId].add(1);
        uint256 toNonce = lastConfirmedRelocationNonces[chainId].add(count);

        pendingRelocations[chainId] = pendingRelocations[chainId].sub(count);
        lastConfirmedRelocationNonces[chainId] = lastConfirmedRelocationNonces[chainId].add(count);

        for (uint256 i = fromNonce; i <= toNonce; i++) {
            Relocation storage relocation = relocations[chainId][i];
            require(
                IERC20Bridgeable(relocation.token).bridge() == address(this),
                "MultiTokenBridge: bridge is not supported by the token contract"
            );
            if (!relocation.canceled) {
                require(
                    IERC20Bridgeable(relocation.token).burnForBridging(
                        relocation.account,
                        relocation.amount
                    ),
                    "MultiTokenBridge: burning of tokens failed"
                );
                emit ConfirmRelocation(
                    chainId,
                    i,
                    relocation.account,
                    relocation.token,
                    relocation.amount
                );
            }
        }
    }

    /**
     * @dev Returns the relocations data for a given destination chain id and a range of nonces.
     * @param chainId The ID of the destination chain.
     * @param nonce The first nonce of the relocation range to return.
     * @param count The number of relocations in the range to return.
     * @return accounts The array of accounts taken from relocations in the requested range.
     * @return tokens The array of token contract taken from relocations in the requested range.
     * @return amounts The array of token amounts taken from relocations in the requested range.
     */
    function getRelocationsData(
        uint256 chainId,
        uint256 nonce,
        uint256 count
    ) public view returns (
        address[] memory accounts,
        address[] memory tokens,
        uint256[] memory amounts
    ) {
        accounts = new address[](count);
        tokens = new address[](count);
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            accounts[i] = relocations[chainId][nonce].account;
            tokens[i] = relocations[chainId][nonce].token;
            amounts[i] = relocations[chainId][nonce].amount;
            nonce = nonce.add(1);
        }
    }

    /**
     * @dev Accommodates new relocation requests with token minting for the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The ID of the source chain.
     * @param nonce The nonce of the first relocation to accommodate.
     * @param accounts The array of accounts from the relocations to accommodate.
     * @param tokens The array of token contract from the relocations to accommodate.
     * @param amounts The array of token amounts from the relocations to accommodate.
     */
    function accommodate(
        uint256 chainId,
        uint256 nonce,
        address[] memory accounts,
        address[] memory tokens,
        uint256[] memory amounts
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            arrivalChains[chainId],
            "MultiTokenBridge: arrival chain is not supported"
        );
        require(
            arrivalNonces[chainId].add(1) == nonce,
            "MultiTokenBridge: relocation nonce mismatch"
        );
        require(
            accounts.length != 0 &&
                accounts.length == tokens.length &&
                accounts.length == amounts.length,
            "MultiTokenBridge: input arrays have different length or are empty"
        );

        for (uint256 i = 0; i < accounts.length; i++) {
            require(
                accounts[i] != address(0),
                "MultiTokenBridge: account is the zero address"
            );
            require(
                tokens[i] != address(0),
                "MultiTokenBridge: token is the zero address"
            );
            require(
                amounts[i] != 0,
                "MultiTokenBridge: amount must be greater than 0"
            );
            require(
                IERC20Bridgeable(tokens[i]).bridge() == address(this),
                "MultiTokenBridge: bridge is not supported by the token contract"
            );
            require(
                IERC20Bridgeable(tokens[i]).mintForBridging(
                    accounts[i],
                    amounts[i]
                ),
                "MultiTokenBridge: minting of tokens failed"
            );
            emit ConfirmArrival(chainId, nonce, accounts[i], tokens[i], amounts[i]);
            nonce = nonce.add(1);
        }

        arrivalNonces[chainId] = nonce.sub(1);
    }

    /**
     * @dev Sets the relocation chain supporting.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination chain to relocate.
     * @param supported True if the destination chain is supported to relocate.
     */
    function setRelocationChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        relocationChains[chainId] = supported;
        emit SetRelocationChain(chainId, supported);
    }

    /**
     * @dev Sets the arrival chain supporting.
     * Can only be called by the current owner.
     * @param chainId The ID of the foreign chain to arrive from.
     * @param supported True if the foreign chain is supported to arrive from.
     */
    function setArrivalChain(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        arrivalChains[chainId] = supported;
        emit SetArrivalChain(chainId, supported);
    }
}
