// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Bridgeable } from "./interfaces/IERC20Bridgeable.sol";
import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Bridgeable contract
 * @author CloudWalk Inc.
 * @dev The ERC20 token implementation that supports the bridge operations.
 */
contract ERC20Bridgeable is ERC20Base, IERC20Bridgeable {
    /// @dev The address of the bridge.
    address private _bridge;

    // -------------------- Errors -----------------------------------

    /// @dev The transaction sender is not a bridge.
    error UnauthorizedBridge(address account);

    /// @dev The zero amount of tokens is passed during the mint operation.
    error ZeroMintForBridgingAmount();

    /// @dev The zero amount of tokens is passed during the burn operation.
    error ZeroBurnForBridgingAmount();

    // -------------------- Modifiers --------------------------------

    /// @dev Throws if called by any account other than the bridge.
    modifier onlyBridge() {
        if (_msgSender() != _bridge) {
            revert UnauthorizedBridge(_msgSender());
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @dev The internal initializer of the upgradable contract.
     */
    function __ERC20Bridgeable_init(
        string memory name_,
        string memory symbol_,
        address bridge_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Bridgeable_init_unchained(bridge_);
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     */
    function __ERC20Bridgeable_init_unchained(address bridge_) internal onlyInitializing {
        _setBridge(bridge_);
    }

    /**
     * @dev See {IERC20Bridgeable-setBridge}.
     */
    function setBridge(address newBridge) external onlyOwner {
        _setBridge(newBridge);
    }

    /**
     * @dev See {IERC20Bridgeable-mintForBridging}.
     *
     * Requirements:
     *
     * - Can only be called by the bridge.
     * - The `amount` value must be greater than zero.
     */
    function mintForBridging(address account, uint256 amount) external onlyBridge returns (bool) {
        if (amount == 0) {
            revert ZeroMintForBridgingAmount();
        }

        _mint(account, amount);
        emit MintForBridging(account, amount);

        return true;
    }

    /**
     * @dev See {IERC20Bridgeable-burnForBridging}.
     *
     * Requirements:
     *
     * - Can only be called by the bridge.
     * - The `amount` value must be greater than zero.
     */
    function burnForBridging(address account, uint256 amount) external onlyBridge returns (bool) {
        if (amount == 0) {
            revert ZeroBurnForBridgingAmount();
        }

        _burn(account, amount);
        emit BurnForBridging(account, amount);

        return true;
    }

    /**
     * @dev See {IERC20Bridgeable-isBridgeSupported}.
     */
    function isBridgeSupported(address bridge_) external view returns (bool) {
        return _bridge == bridge_;
    }

    /// @dev Returns the bridge address.
    function bridge() external view virtual returns (address) {
        return _bridge;
    }

    /**
     * @dev See {IERC20Bridgeable-isIERC20Bridgeable}.
     */
    function isIERC20Bridgeable() external pure returns (bool) {
        return true;
    }

    function _setBridge(address newBridge) internal {
        emit SetBridge(newBridge, _bridge);
        _bridge = newBridge;
    }
}
