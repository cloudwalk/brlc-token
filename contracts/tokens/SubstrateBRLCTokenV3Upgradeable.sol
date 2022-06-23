// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {IERC20Bridgeable} from "../base/interfaces/IERC20Bridgeable.sol";
import {SubstrateBRLCTokenV2Upgradeable} from "./SubstrateBRLCTokenV2Upgradeable.sol";

/**
 * @title SubstrateBRLCTokenV3Upgradeable contract
 * @dev V3 changes:
 * - Added `relocate` and `accomodate` functionality.
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
     * @dev Mints and accommodates tokens from the bridge.
     * @param account The owner of tokens to accommodate.
     * @param amount The amount of tokens to accommodate.
     * @return True if the operation was successful.
     */
    function mintAndAccommodate(address account, uint256 amount)
        external
        override
        onlyBridge
        returns (bool)
    {
        require(
            account != address(0),
            "Bridgeable: accommodate to the zero address"
        );
        require(
            amount > 0,
            "Bridgeable: accommodate amount not greater than 0"
        );

        _mint(account, amount);
        emit MintAndAccommodate(account, amount);

        return true;
    }

    /**
     * @dev Burns and relocates tokens from the bridge.
     * @param account The owner of tokens to relocate.
     * @param amount The amount of tokens to relocate.
     * @return True if the operation was successful.
     */
    function burnAndRelocate(address account, uint256 amount)
        external
        override
        onlyBridge
        returns (bool)
    {
        require(amount > 0, "Bridgeable: relocate amount not greater than 0");
        require(
            balanceOf(_msgSender()) >= amount,
            "Bridgeable: relocate amount exceeds balance"
        );

        _burn(_msgSender(), amount);
        emit BurnAndRelocate(account, amount);

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
