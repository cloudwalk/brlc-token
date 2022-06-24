// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {IERC20Bridgeable} from "../base/interfaces/IERC20Bridgeable.sol";
import {SubstrateBRLCTokenV2Upgradeable} from "./SubstrateBRLCTokenV2Upgradeable.sol";

/**
 * @title SubstrateBRLCTokenV3Upgradeable contract
 * @dev V3 changes:
 * - Added bridging functionality.
 */
contract SubstrateBRLCTokenV3Upgradeable is
    SubstrateBRLCTokenV2Upgradeable,
    IERC20Bridgeable
{
    address private _bridge;

    event BridgeChanged(address indexed newBridge);

    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public virtual override initializer {
        __SubstrateBRLCTokenUpgradeable_init(name_, symbol_, decimals_);
        __SubstrateBRLCTokenV2Upgradeable_init_unchained();
        __SubstrateBRLCTokenV3Upgradeable_init_unchained();
    }

    function __SubstrateBRLCTokenV3Upgradeable_init_unchained()
        internal
        initializer
    {}

    /**
     * @dev Throws if called by any account other than the bridge.
     */
    modifier onlyBridge() {
        require(
            _msgSender() == bridge(),
            "Bridgeable: caller is not the bridge"
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
            "Bridgeable: minting for the zero address"
        );
        require(
            amount > 0,
            "Bridgeable: minting amount is not greater than 0"
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
        require(amount > 0, "Bridgeable: burning amount is not greater than 0");
        require(
            balanceOf(_msgSender()) >= amount,
            "Bridgeable: burning amount exceeds the bridge balance"
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
