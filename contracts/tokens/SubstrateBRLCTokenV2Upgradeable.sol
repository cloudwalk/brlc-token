// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {IERC20Mintable} from "../base/interfaces/IERC20Mintable.sol";
import {SubstrateBRLCTokenUpgradeable} from "./SubstrateBRLCTokenUpgradeable.sol";

/**
 * @title SubstrateBRLCTokenV2Upgradeable contract
 * V2 changes:
 * - Added `trusted mint` and `trusted burn` functionality
 */
contract SubstrateBRLCTokenV2Upgradeable is
    SubstrateBRLCTokenUpgradeable,
    IERC20Mintable
{
    using SafeMathUpgradeable for uint256;

    address private _masterMinter;
    mapping(address => bool) private _minters;
    mapping(address => uint256) private _mintersAllowance;

    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public override initializer {
        __SubstrateBRLCTokenUpgradeable_init(name_, symbol_, decimals_);
        __SubstrateBRLCTokenV2Upgradeable_init_unchained();
    }

    function __SubstrateBRLCTokenV2Upgradeable_init_unchained()
        internal
        initializer
    {}

    /**
     * @dev Throws if called by any account other than the masterMinter
     */
    modifier onlyMasterMinter() {
        require(
            _msgSender() == masterMinter(),
            "MintAndBurn: caller is not the masterMinter"
        );
        _;
    }

    /**
     * @dev Throws if called by any account other than a minter
     */
    modifier onlyMinters() {
        require(_minters[_msgSender()], "MintAndBurn: caller is not a minter");
        _;
    }

    /**
     * @dev Returns masterMinter address
     */
    function masterMinter() public view override returns (address) {
        return _masterMinter;
    }

    /**
     * @dev Checks if account is a minter
     * @param account The address to check
     */
    function isMinter(address account) external view override returns (bool) {
        return _minters[account];
    }

    /**
     * @dev Returns minter allowance for an account
     * @param minter The address of the minter
     */
    function minterAllowance(address minter)
        external
        view
        override
        returns (uint256)
    {
        return _mintersAllowance[minter];
    }

    /**
     * @dev Updates master minter address
     * @param newMasterMinter The address of new master minter
     */
    function updateMasterMinter(address newMasterMinter)
        external
        override
        onlyOwner
    {
        _masterMinter = newMasterMinter;
        emit MasterMinterChanged(_masterMinter);
    }

    /**
     * @dev Updates minter configuration
     * @param minter The address of the minter to configure
     * @param mintAllowance The minting amount allowed for the minter
     * @return True if the operation was successful
     */
    function configureMinter(address minter, uint256 mintAllowance)
        external
        override
        whenNotPaused
        onlyMasterMinter
        returns (bool)
    {
        _minters[minter] = true;
        _mintersAllowance[minter] = mintAllowance;
        emit MinterConfigured(minter, mintAllowance);
        return true;
    }

    /**
     * @dev Removes minter
     * @param minter The address of the minter to remove
     * @return True if the operation was successful
     */
    function removeMinter(address minter)
        external
        override
        onlyMasterMinter
        returns (bool)
    {
        _minters[minter] = false;
        _mintersAllowance[minter] = 0;
        emit MinterRemoved(minter);
        return true;
    }

    /**
     * @dev Mints tokens in a trusted way
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint. Must be less
     * than or equal to the mintAllowance of the caller
     * @return True if the operation was successful
     */
    function mint(address to, uint256 amount)
        external
        override
        whenNotPaused
        onlyMinters
        notBlacklisted(_msgSender())
        notBlacklisted(to)
        returns (bool)
    {
        require(to != address(0), "MintAndBurn: mint to the zero address");
        require(amount > 0, "MintAndBurn: mint amount not greater than 0");

        uint256 mintAllowance = _mintersAllowance[_msgSender()];
        require(
            amount <= mintAllowance,
            "MintAndBurn: mint amount exceeds mintAllowance"
        );

        _mint(to, amount);
        _mintersAllowance[_msgSender()] = mintAllowance.sub(amount);
        emit Mint(_msgSender(), to, amount);
        return true;
    }

    /**
     * @dev Burns tokens in a trusted way
     * @param amount The amount of tokens to be burned. Must be less
     * than or equal to the token balance of the caller
     */
    function burn(uint256 amount)
        external
        override
        whenNotPaused
        onlyMinters
        notBlacklisted(_msgSender())
    {
        require(amount > 0, "MintAndBurn: burn amount not greater than 0");

        uint256 balance = balanceOf(_msgSender());
        require(balance >= amount, "MintAndBurn: burn amount exceeds balance");

        _burn(_msgSender(), amount);
        emit Burn(_msgSender(), amount);
    }
}
