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

    event SetSupportedRelocation(
        uint256 indexed chainId,
        bool supported
    );
    event SetSupportedArrival(
        uint256 indexed chainId,
        bool supported
    );
    event RegisterRelocation(
        uint256 indexed chainId,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event CancelRelocation(
        uint256 indexed chainId,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event ConfirmRelocation(
        uint256 indexed chainId,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );
    event ConfirmArrival(
        uint256 indexed chainId,
        address indexed account,
        uint256 amount,
        uint256 nonce
    );

    struct Relocation {
        address account;
        uint256 amount;
        bool canceled;
    }

    /// @dev The address of the underlying token.
    address public token;

    /// @dev The mapping: a chain ID => the number of pending relocation requests to that chain.
    mapping(uint256 => uint256) public pendingRelocationCounters;

    /// @dev The mapping: a chain ID => the nonce of the last confirmed relocation requests to that chain.
    mapping(uint256 => uint256) public lastConfirmedRelocationNonces;

    /// @dev The mapping: a chain ID => the flag of supporting relocations to that chain
    mapping(uint256 => bool) public relocationSupportingFlags;

    /// @dev The mapping: a chain ID, a nonce => the relocation structure corresponding to that chain and nonce.
    mapping(uint256 => mapping(uint256 => Relocation)) public relocations;

    /// @dev The mapping: a chain ID => the flag of supporting arrivals from that chain
    mapping(uint256 => bool) public arrivalSupportingFlags;

    /// @dev The mapping: a chain ID => the nonce of the last accommodated relocation request come from that chain.
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
        require(
            isTokenIERC20BridgeableInternal(_token),
            "TokenBridge: token contract does not support bridge operations"
        );
        token = _token;
    }

    /**
     * @dev Registers a new relocation request with transferring tokens from an account to the bridge.
     * Can only be called when the contract is not paused.
     * @param chainId The ID of the destination chain.
     * @param amount Amount of tokens that will be relocated.
     * @return nonce The nonce of the relocation request.
     */
    function registerRelocation(uint256 chainId, uint256 amount)
        external
        whenNotPaused
        returns (uint256 nonce)
    {
        require(
            amount > 0,
            "TokenBridge: relocation amount must be greater than 0"
        );
        require(
            relocationSupportingFlags[chainId],
            "TokenBridge: chain is not supported for relocation"
        );
        require(
            IERC20Bridgeable(token).isBridgeSupported(address(this)),
            "TokenBridge: bridge is not supported by the token contract"
        );

        uint256 newPendingRelocationCount = pendingRelocationCounters[chainId].add(1);
        nonce = lastConfirmedRelocationNonces[chainId].add(newPendingRelocationCount);
        pendingRelocationCounters[chainId] = newPendingRelocationCount;
        Relocation storage relocation = relocations[chainId][nonce];
        relocation.account = _msgSender();
        relocation.amount = amount;

        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            amount
        );

        emit RegisterRelocation(
            chainId,
            _msgSender(),
            amount,
            nonce
        );
    }

    /**
     * @dev Returns the relocations data for a given destination chain ID and a range of nonces.
     * @param chainId The ID of the destination chain.
     * @param nonce The first nonce of the relocation range to return.
     * @param count The number of relocations in the range to return.
     * @return accounts The array of accounts taken from relocations in the requested range.
     * @return amounts The array of token amounts taken from relocations in the requested range.
     * @return cancellationFlags The array of cancellation flags taken from relocations in the requested range.
     */
    function getRelocationsData(
        uint256 chainId,
        uint256 nonce,
        uint256 count
    ) external view returns (
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory cancellationFlags
    ) {
        accounts = new address[](count);
        amounts = new uint256[](count);
        cancellationFlags = new bool[](count);
        for (uint256 i = 0; i < count; i++) {
            Relocation storage relocation = relocations[chainId][nonce];
            accounts[i] = relocation.account;
            amounts[i] = relocation.amount;
            cancellationFlags[i] = relocation.canceled;
            nonce = nonce.add(1);
        }
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
            "TokenBridge: transaction sender is not authorized"
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
            "TokenBridge: relocation nonces array is empty"
        );

        for (uint256 i = 0; i < nonces.length; i++) {
            cancelRelocationInternal(chainId, nonces[i]);
        }
    }

    function cancelRelocationInternal(uint256 chainId, uint256 nonce) internal {
        uint256 lastConfirmedRelocationNonce = lastConfirmedRelocationNonces[chainId];
        require(
            nonce > lastConfirmedRelocationNonce,
            "TokenBridge: relocation with the nonce already processed"
        );
        require(
            // It is safe to use '+' here instead of 'add()' due to the checks in the relocation registration function
            nonce <= lastConfirmedRelocationNonce + pendingRelocationCounters[chainId],
            "TokenBridge: relocation with the nonce does not exist"
        );

        Relocation storage relocation = relocations[chainId][nonce];

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
            chainId,
            relocation.account,
            relocation.amount,
            nonce
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
            "TokenBridge: count should be greater than zero"
        );
        uint256 currentPendingRelocationCount = pendingRelocationCounters[chainId];
        require(
            count <= currentPendingRelocationCount,
            "TokenBridge: count exceeds the number of pending relocations"
        );
        require(
            IERC20Bridgeable(token).isBridgeSupported(address(this)),
            "TokenBridge: bridge is not supported by the token contract"
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
                    IERC20Bridgeable(token).burnForBridging(
                        relocation.account,
                        relocation.amount
                    ),
                    "TokenBridge: burning of tokens failed"
                );
                emit ConfirmRelocation(
                    chainId,
                    relocation.account,
                    relocation.amount,
                    nonce
                );
            }
        }
    }

    /**
     * @dev Accommodates new relocation requests with token minting for the accounts.
     * Can only be called when the contract is not paused.
     * Can only be called by a whitelisted address.
     * @param chainId The ID of the source chain.
     * @param nonce The nonce of the first relocation to accommodate.
     * @param accounts The array of accounts from the relocations to accommodate.
     * @param amounts The array of token amounts from the relocations to accommodate.
     * @param cancellationFlags The array of cancellation flags from relocations to accommodate.
     */
    function accommodate(
        uint256 chainId,
        uint256 nonce,
        address[] memory accounts,
        uint256[] memory amounts,
        bool[] memory cancellationFlags
    ) public whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            arrivalSupportingFlags[chainId],
            "TokenBridge: chain is not supported for arrival"
        );
        require(
            nonce > 0,
            "TokenBridge: must be greater than 0"
        );
        require(
            arrivalNonces[chainId] == (nonce - 1),
            "TokenBridge: relocation nonce mismatch"
        );
        require(
            accounts.length != 0 &&
                accounts.length == amounts.length &&
                accounts.length == cancellationFlags.length,
            "TokenBridge: input arrays have different length or are empty"
        );
        require(
            IERC20Bridgeable(token).isBridgeSupported(address(this)),
            "TokenBridge: bridge is not supported by the token contract"
        );

        for (uint256 i = 0; i < accounts.length; i++) {
            require(
                accounts[i] != address(0),
                "TokenBridge: account is the zero address"
            );
            require(
                amounts[i] != 0,
                "TokenBridge: amount must be greater than 0"
            );
            if (!cancellationFlags[i]) {
                require(
                    IERC20Bridgeable(token).mintForBridging(
                        accounts[i],
                        amounts[i]
                    ),
                    "TokenBridge: minting of tokens failed"
                );
                emit ConfirmArrival(
                    chainId,
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
     * @dev Sets the relocation supporting for a destination chain.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination chain to relocate to.
     * @param supported True if the relocation is supported.
     */
    function setSupportedRelocation(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        relocationSupportingFlags[chainId] = supported;
        emit SetSupportedRelocation(chainId, supported);
    }

    /**
     * @dev Sets the arrival supporting for a destination chain.
     * Can only be called by the current owner.
     * @param chainId The ID of the destination chain to arrive from.
     * @param supported True if the arrival is supported.
     */
    function setSupportedArrival(uint256 chainId, bool supported)
        external
        onlyOwner
    {
        arrivalSupportingFlags[chainId] = supported;
        emit SetSupportedArrival(chainId, supported);
    }

    // Safely call the appropriate function from the IERC20Bridgeable interface
    function isTokenIERC20BridgeableInternal(address _token) internal virtual returns (bool) {
        (bool success, bytes memory result) = _token.staticcall(
            abi.encodeWithSignature("isIERC20Bridgeable()")
        );
        if (success && result.length > 0) {
            return abi.decode(result, (bool));
        } else {
            return false;
        }
    }
}
