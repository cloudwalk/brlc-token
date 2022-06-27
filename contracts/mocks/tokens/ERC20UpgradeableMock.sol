// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IERC20Bridgeable} from "../../base/interfaces/IERC20Bridgeable.sol";

/**
 * @title ERC20UpgradeableMock contract
 * @dev An implementation of the {ERC20Upgradeable} contract for test purposes.
 */
contract ERC20UpgradeableMock is ERC20Upgradeable, IERC20Bridgeable {

    address private _bridge;
    bool private _isMintingForBridgingDisabled;
    bool private _isBurningForBridgingDisabled;

    /**
     * @dev The initialize function of the upgradable contract.
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     * @param decimals_ The decimals of the token to set for this ERC20-comparable contract.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        _setupDecimals(decimals_);
    }

    /**
     * @dev Cals the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    /**
     * @dev Cals the appropriate internal function to burn needed amount of tokens.
     * @param amount The amount of tokens of this contract to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Mints tokens as part of a bridge operation.
     * @param account The owner of the tokens passing through the bridge.
     * @param amount The amount of tokens passing through the bridge.
     * @return True if the operation was successful.
     */
    function mintForBridging(address account, uint256 amount) external override returns (bool) {
        if (_isMintingForBridgingDisabled) {
            return false;
        }
        _mint(account, amount);
        emit MintForBridging(account, amount);
        return true;
    }

    /**
     * @dev Burns tokens as part of a bridge operation.
     * @param account The owner of the tokens passing through the bridge.
     * @param amount The amount of tokens passing through the bridge.
     * @return True if the operation was successful.
     */
    function burnForBridging(address account, uint256 amount) external override returns (bool) {
        if (_isBurningForBridgingDisabled) {
            return false;
        }
        _burn(msg.sender, amount);
        emit BurnForBridging(account, amount);
        return true;
    }

    /// @dev Returns the address of the bridge.
    function bridge() public view override returns (address) {
        return _bridge;
    }

    /**
     * @dev Sets the address of the bridge.
     * @param newBridge The address of the new bridge.
     */
    function setBridge(address newBridge) external {
        _bridge = newBridge;
    }

    /// @dev Disables token minting for bridging operations
    function disableMintingForBridging() external {
        _isMintingForBridgingDisabled = true;
    }

    /// @dev Disables token burning for bridging operations
    function disableBurningForBridging() external {
        _isBurningForBridgingDisabled = true;
    }
}
