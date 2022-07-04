// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {IERC20Mintable} from "../../base/interfaces/IERC20Mintable.sol";
import {BaseTokenUpgradeable} from "./BaseTokenUpgradeable.sol";

/**
 * @title MintableTokenUpgradeable contract
 */
abstract contract MintableTokenUpgradeable is BaseTokenUpgradeable, IERC20Mintable {
    using SafeMathUpgradeable for uint256;

    /// @dev The address of the master minter.
    address private _masterMinter;

    /// @dev The mapping of registered minters.
    mapping(address => bool) private _minters;

    /// @dev The mapping of minters for mint allowances.
    mapping(address => uint256) private _mintersAllowance;

    function __MintableToken_init(
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
        __MintableToken_init_unchained();
    }

    function __MintableToken_init_unchained() internal initializer {}

    /**
     * @dev Throws if called by any account other than the masterMinter.
     */
    modifier onlyMasterMinter() {
        require(
            _msgSender() == masterMinter(),
            "MintableToken: caller is not the masterMinter"
        );
        _;
    }

    /**
     * @dev Throws if called by any account other than a minter.
     */
    modifier onlyMinters() {
        require(_minters[_msgSender()], "MintableToken: caller is not a minter");
        _;
    }

    /**
     * @dev Returns masterMinter address.
     */
    function masterMinter() public view override returns (address) {
        return _masterMinter;
    }

    /**
     * @dev Checks if account is a minter.
     * @param account An address to check.
     */
    function isMinter(address account) external view override returns (bool) {
        return _minters[account];
    }

    /**
     * @dev Returns the minter allowance for an account.
     * @param minter The address of a minter.
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
     * @dev Updates the master minter address.
     * @param newMasterMinter The address of a new master minter.
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
     * @dev Updates a minter configuration.
     * @param minter The address of a minter to configure.
     * @param mintAllowance The minting amount allowed for a minter.
     * @return True if the operation was successful.
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
     * @dev Removes a minter.
     * @param minter The address of a minter to remove.
     * @return True if the operation was successful.
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
     * @dev Mints tokens in a trusted way.
     * @param to The address that will receive the minted tokens.
     * @param amount The amount of tokens to mint. Must be less
     * than or equal to the mint allowance of the caller.
     * @return True if the operation was successful.
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
        require(to != address(0), "MintableToken: mint to the zero address");
        require(amount > 0, "MintableToken: mint amount not greater than 0");

        uint256 mintAllowance = _mintersAllowance[_msgSender()];
        require(
            amount <= mintAllowance,
            "MintableToken: mint amount exceeds mintAllowance"
        );

        _mint(to, amount);
        _mintersAllowance[_msgSender()] = mintAllowance.sub(amount);
        emit Mint(_msgSender(), to, amount);
        return true;
    }

    /**
     * @dev Burns tokens in a trusted way.
     * @param amount The amount of tokens to be burned. Must be less
     * than or equal to the token balance of the caller.
     */
    function burn(uint256 amount)
        external
        override
        whenNotPaused
        onlyMinters
        notBlacklisted(_msgSender())
    {
        require(amount > 0, "MintableToken: burn amount not greater than 0");

        uint256 balance = balanceOf(_msgSender());
        require(balance >= amount, "MintableToken: burn amount exceeds balance");

        _burn(_msgSender(), amount);
        emit Burn(_msgSender(), amount);
    }
}
