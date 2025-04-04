// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { IERC20Bridgeable } from "./interfaces/IERC20Bridgeable.sol";
import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Bridgeable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The ERC20 token implementation that supports bridging operations
 */
abstract contract ERC20Bridgeable is ERC20Base, IERC20Bridgeable {
    /// @notice The address of the bridge
    address private _bridge;

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a bridge
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedBridge(address account);

    /// @notice The zero amount of tokens is passed during the mint operation
    error ZeroMintForBridgingAmount();

    /// @notice The zero amount of tokens is passed during the burn operation
    error ZeroBurnForBridgingAmount();

    // -------------------- Modifiers --------------------------------

    /// @notice Throws if called by any account other than the bridge
    modifier onlyBridge() {
        if (_msgSender() != _bridge) {
            revert UnauthorizedBridge(_msgSender());
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param bridge_ The address of the bridge contract
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
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Bridgeable_init_unchained(bridge_);
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * @param bridge_ The address of the bridge contract
     */
    function __ERC20Bridgeable_init_unchained(address bridge_) internal onlyInitializing {
        _setBridge(bridge_);
    }

    /**
     * @inheritdoc IERC20Bridgeable
     */
    function setBridge(address newBridge) external onlyOwner {
        _setBridge(newBridge);
    }

    /**
     * @inheritdoc IERC20Bridgeable
     *
     * @dev Can only be called by the bridge
     * @dev The `amount` value must be greater than zero
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
     * @inheritdoc IERC20Bridgeable
     *
     * @dev Can only be called by the bridge
     * @dev The `amount` value must be greater than zero
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
     * @inheritdoc IERC20Bridgeable
     */
    function isBridgeSupported(address bridge_) external view returns (bool) {
        return _bridge == bridge_;
    }

    /**
     * @inheritdoc IERC20Bridgeable
     */
    function isIERC20Bridgeable() external pure returns (bool) {
        return true;
    }

    /**
     * @notice Returns the address of the bridge contract
     */
    function bridge() external view virtual returns (address) {
        return _bridge;
    }

    /**
     * @notice Sets the new bridge contract
     *
     * @param newBridge The address of the new bridge contract
     */
    function _setBridge(address newBridge) internal {
        emit SetBridge(newBridge, _bridge);
        _bridge = newBridge;
    }
}
