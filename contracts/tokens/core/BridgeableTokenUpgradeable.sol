// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {IERC20Bridgeable} from "../../base/interfaces/IERC20Bridgeable.sol";
import {BaseTokenUpgradeable} from "./BaseTokenUpgradeable.sol";

/**
 * @title BridgeableTokenUpgradeable contract
 */
abstract contract BridgeableTokenUpgradeable is BaseTokenUpgradeable, IERC20Bridgeable {
    event BridgeChanged(address indexed newBridge);

    /// @dev The address of the bridge.
    address private _bridge;

    function __BridgeableToken_init(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BaseToken_init_unchained(decimals_);
        __BridgeableToken_init_unchained();
    }

    function __BridgeableToken_init_unchained() internal initializer {}

    /**
     * @dev Throws if called by any account other than the bridge.
     */
    modifier onlyBridge() {
        require(
            _msgSender() == bridge(),
            "BridgeableToken: caller is not the bridge"
        );
        _;
    }

    /**
     * @dev Mints tokens as part of a bridge operation.
     * @param account The owner of the tokens passing through the bridge.
     * @param amount The amount of tokens passing through the bridge.
     * @return True if the operation was successful.
     */
    function mintForBridging(address account, uint256 amount)
        external
        override
        onlyBridge
        returns (bool)
    {
        require(
            account != address(0),
            "BridgeableToken: minting for the zero address"
        );
        require(
            amount > 0,
            "BridgeableToken: minting amount is not greater than 0"
        );

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
    function burnForBridging(address account, uint256 amount)
        external
        override
        onlyBridge
        returns (bool)
    {
        require(
            amount > 0,
            "BridgeableToken: burning amount is not greater than 0"
        );
        require(
            balanceOf(_msgSender()) >= amount,
            "BridgeableToken: burning amount exceeds the bridge balance"
        );

        _burn(_msgSender(), amount);
        emit BurnForBridging(account, amount);

        return true;
    }

    /**
     * @dev Returns the address of the bridge.
     */
    function bridge() public view override returns (address) {
        return _bridge;
    }

    /**
     * @dev Sets the address of the bridge.
     * @param newBridge The address of the new bridge.
     */
    function setBridge(address newBridge) external onlyOwner {
        _bridge = newBridge;
        emit BridgeChanged(newBridge);
    }
}
