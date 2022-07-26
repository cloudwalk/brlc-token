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

    event SetSupportedRelocation(
        uint256 indexed chainId,
        address indexed token,
        bool supported
    );
    event SetSupportedArrival(
        uint256 indexed chainId,
        address indexed token,
        bool supported
    );
    event RegisterRelocation(
        uint256 indexed chainId,
        address indexed token,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event CancelRelocation(
        uint256 indexed chainId,
        address indexed token,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event ConfirmRelocation(
        uint256 indexed chainId,
        address indexed token,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event ConfirmArrival(
        uint256 indexed chainId,
        address indexed token,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );

    struct Relocation {
        address token;
        address account;
        uint256 amount;
        bool canceled;
    }

    /// @dev The mapping: a chain ID => the number of pending relocation requests to that chain.
    mapping(uint256 => uint256) public pendingRelocationCounters;

    /// @dev The mapping: a chain ID => the nonce of the last confirmed relocation requests to that chain.
    mapping(uint256 => uint256) public lastConfirmedRelocationNonces;

    /**
     * @dev The mapping: a chain ID, a token contract address => the flag of supporting relocations
     * for that token to that chain
     */
    mapping(uint256 => mapping(address => bool)) public relocationSupportingFlags;

    /// @dev The mapping: a chain ID, a nonce => the relocation structure corresponding to that chain and nonce.
    mapping(uint256 => mapping(uint256 => Relocation)) public relocations;

    /**
     * @dev The mapping: a chain ID, a token contract address => the flag of supporting arrivals
     * for that token from that chain
     */
    mapping(uint256 => mapping(address => bool)) public arrivalSupportingFlags;

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
    function registerRelocation(
        uint256 chainId,
        address token,
        uint256 amount
    )
        external
        whenNotPaused
        returns (uint256 nonce)
    {
        require(
            token != address(0),
                "MultiTokenBridge: token is the zero address"
        );
        require(
            amount > 0,
            "MultiTokenBridge: relocation amount must be greater than 0"
        );
        require(
            relocationSupportingFlags[chainId][token],
            "MultiTokenBridge: chain or token is not supported for relocation"
        );
        require(
            IERC20Bridgeable(token).isBridgeSupported(address(this)),
            "MultiTokenBridge: bridge is not supported by the token contract"
        );

        uint256 newPendingRelocationCount = pendingRelocationCounters[chainId].add(1);
        nonce = lastConfirmedRelocationNonces[chainId].add(newPendingRelocationCount);
        pendingRelocationCounters[chainId] = newPendingRelocationCount;
        Relocation storage relocation = relocations[chainId][nonce];
        relocation.account = _msgSender();
        relocation.token = token;
        relocation.amount = amount;

        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        emit RegisterRelocation(
            chainId,
            token,
            _msgSender(),
            amount,
            nonce
        );
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
        uint256 currentPendingRelocationCount = pendingRelocationCounters[chainId];
        require(
            count <= currentPendingRelocationCount,
            "MultiTokenBridge: count exceeds the number of pending relocations"
        );

        // It is safe to use '+' here instead of 'add()' due to the checks in the relocation registration function
        uint256 fromNonce = lastConfirmedRelocationNonces[chainId] + 1;
        uint256 toNonce = fromNonce + count - 1;

        // It is safe to use '-' here instead of 'sub()' due to the checks above
        pendingRelocationCounters[chainId] = currentPendingRelocationCount - count;
        lastConfirmedRelocationNonces[chainId] = toNonce;

        for (uint256 nonce = fromNonce; nonce <= toNonce; nonce++) {
            Relocation storage relocation = relocations[chainId][nonce];
            if (!relocation.canceled) {
                require(
                    IERC20Bridgeable(relocation.token).isBridgeSupported(address(this)),
                    "MultiTokenBridge: bridge is not supported by the token contract."
                );
                require(
                    IERC20Bridgeable(relocation.token).burnForBridging(
                        relocation.account,
                        relocation.amount
                    ),
                    "MultiTokenBridge: burning of tokens failed"
                );
                emit ConfirmRelocation(
                    chainId,
                    relocation.token,
                    relocation.account,
                    relocation.amount,
                    nonce
                );
            }
        }
    }

    /**
     * @dev Returns the relocations data for a given destination chain id and a range of nonces.
     * @param chainId The ID of the destination chain.
     * @param nonce The first nonce of the relocation range to return.
     * @param count The number of relocations in the range to return.
     * @return tokens The array of token contract taken from relocations in the requested range.
     * @return accounts The array of accounts taken from relocations in the requested range.
     * @return amounts The array of token amounts taken from relocations in the requested range.
     * @return cancellationFlags The array of cancellation flags taken from relocations in the requested range.
     */
    function getRelocationsData(
        uint256 chainId,
        uint256 nonce,
        uint256 count
    ) external view returns (
        address[] memory tokens,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory cancellationFlags
    ) {
        accounts = new address[](count);
        tokens = new address[](count);
        amounts = new uint256[](count);
        cancellationFlags = new bool[](count);
        for (uint256 i = 0; i < count; i++) {
            Relocation storage relocation = relocations[chainId][nonce];
            accounts[i] = relocation.account;
            tokens[i] = relocation.token;
            amounts[i] = relocation.amount;
            cancellationFlags[i] = relocation.canceled;
            nonce = nonce.add(1);
        }
    }

    /**
     * @dev Accommodates new relocation requests with token minting for the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The ID of the source chain.
     * @param nonce The nonce of the first relocation to accommodate.
     * @param tokens The array of token contract from the relocations to accommodate.
     * @param accounts The array of accounts from the relocations to accommodate.
     * @param amounts The array of token amounts from the relocations to accommodate.
     * @param cancellationFlags The array of cancellation flags from relocations to accommodate.
     */
    function accommodate(
        uint256 chainId,
        uint256 nonce,
        address[] memory tokens,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory cancellationFlags
    )
        public
        whenNotPaused
        onlyWhitelisted(_msgSender())
    {
        require(
            nonce > 0,
            "MultiTokenBridge: must be greater than 0"
        );
        require(
            arrivalNonces[chainId] == (nonce - 1),
            "MultiTokenBridge: relocation nonce mismatch"
        );
        require(
            tokens.length != 0 &&
            tokens.length == accounts.length &&
            tokens.length == amounts.length &&
            tokens.length == cancellationFlags.length,
            "MultiTokenBridge: input arrays have different length or are empty"
        );

        for (uint256 i = 0; i < accounts.length; i++) {
            require(
                arrivalSupportingFlags[chainId][tokens[i]],
                "MultiTokenBridge: chain or token is not supported for arrival"
            );
            require(
                accounts[i] != address(0),
                "MultiTokenBridge: account is the zero address"
            );
            require(
                amounts[i] != 0,
                "MultiTokenBridge: amount must be greater than 0"
            );
            if (!cancellationFlags[i]) {
                require(
                    IERC20Bridgeable(tokens[i]).isBridgeSupported(address(this)),
                    "MultiTokenBridge: bridge is not supported by the token contract"
                );
                require(
                    IERC20Bridgeable(tokens[i]).mintForBridging(
                        accounts[i],
                        amounts[i]
                    ),
                    "MultiTokenBridge: minting of tokens failed"
                );
                emit ConfirmArrival(
                    chainId,
                    tokens[i],
                    accounts[i],
                    amounts[i],
                    nonce
                );
            }
            nonce = nonce.add(1);
        }

        arrivalNonces[chainId] = nonce - 1;
    }

    /**
     * @dev Sets the relocation supporting for a destination chain and a local token.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination chain to relocate to.
     * @param token The address of the local token contract whose coins can be relocated.
     * @param supported True if the relocation is supported.
     */
    function setSupportedRelocation(
        uint256 chainId,
        address token,
        bool supported
    )
        external
        onlyOwner
    {
        require(
            isTokenIERC20BridgeableInternal(token),
            "MultiTokenBridge: token contract does not support bridge operations"
        );
        relocationSupportingFlags[chainId][token] = supported;
        emit SetSupportedRelocation(chainId, token, supported);
    }

    /**
     * @dev Sets the arrival supporting for a destination chain and a local token.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination chain to arrive from.
     * @param token The address of the local token contract whose coins can be arrived.
     * @param supported True if the arrival is supported.
     */
    function setSupportedArrival(
        uint256 chainId,
        address token,
        bool supported
    )
        external
        onlyOwner
    {
        require(
            isTokenIERC20BridgeableInternal(token),
            "MultiTokenBridge: token contract does not support bridge operations"
        );
        arrivalSupportingFlags[chainId][token] = supported;
        emit SetSupportedArrival(chainId, token, supported);
    }

    function cancelRelocationInternal(uint256 chainId, uint256 nonce) internal {
        uint256 lastConfirmedRelocationNonce = lastConfirmedRelocationNonces[chainId];
        require(
            nonce > lastConfirmedRelocationNonce,
            "MultiTokenBridge: relocation with the nonce already processed"
        );
        require(
        // It is safe to use '+' here instead of 'add()' due to the checks in the relocation registration function
            nonce <= lastConfirmedRelocationNonce + pendingRelocationCounters[chainId],
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
            relocation.token,
            relocation.account,
            relocation.amount,
            nonce
        );
    }

    // Safely call the appropriate function from the IERC20Bridgeable interface
    function isTokenIERC20BridgeableInternal(address token) internal virtual returns (bool) {
        (bool success, bytes memory result) = token.staticcall(
            abi.encodeWithSignature("isIERC20Bridgeable()")
        );
        if (success && result.length > 0) {
            return abi.decode(result, (bool));
        } else {
            return false;
        }
    }
}
