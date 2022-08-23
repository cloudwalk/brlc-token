// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Mintable } from "./base/interfaces/IERC20Mintable.sol";
import { BRLCToken } from "./BRLCToken.sol";

/**
 * @title BRLCTokenMintable contract
 */
contract BRLCTokenMintable is BRLCToken, IERC20Mintable {
    address private _masterMinter;
    mapping(address => bool) private _minters;
    mapping(address => uint256) private _mintersAllowance;

    error UnauthorizedMasterMinter(address account);
    error UnauthorizedMinter(address account);
    error ExceededMintAllowance();
    error ZeroMintAmount();
    error ZeroBurnAmount();

    function initialize(string memory name_, string memory symbol_) public virtual initializer {
        __BRLCTokenMintable_init(name_, symbol_);
    }

    function __BRLCTokenMintable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCToken_init_unchained();
        __BRLCTokenMintable_init_unchained();
    }

    function __BRLCTokenMintable_init_unchained() internal onlyInitializing {}

    /**
     * @dev Throws if called by any account other than the masterMinter.
     */
    modifier onlyMasterMinter() {
        if (_msgSender() != _masterMinter) {
            revert UnauthorizedMasterMinter(_msgSender());
        }
        _;
    }

    /**
     * @dev Throws if called by any account other than a minter.
     */
    modifier onlyMinter() {
        if (!_minters[_msgSender()]) {
            revert UnauthorizedMinter(_msgSender());
        }
        _;
    }

    /**
     * @dev Returns masterMinter address.
     */
    function masterMinter() public view returns (address) {
        return _masterMinter;
    }

    /**
     * @dev Checks if account is a minter.
     * @param account An address to check.
     */
    function isMinter(address account) external view returns (bool) {
        return _minters[account];
    }

    /**
     * @dev Returns the minter allowance for an account.
     * @param minter The address of a minter.
     */
    function minterAllowance(address minter) external view returns (uint256) {
        return _mintersAllowance[minter];
    }

    /**
     * @dev Updates the master minter address.
     * @param newMasterMinter The address of a new master minter.
     */
    function updateMasterMinter(address newMasterMinter) external onlyOwner {
        if (_masterMinter == newMasterMinter) {
            return;
        }

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
    function removeMinter(address minter) external onlyMasterMinter returns (bool) {
        if (!_minters[minter]) {
            return true;
        }

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
    function mint(address account, uint256 amount)
        external
        whenNotPaused
        onlyMinter
        notBlacklisted(_msgSender())
        notBlacklisted(account)
        returns (bool)
    {
        if (amount == 0) {
            revert ZeroMintAmount();
        }

        uint256 mintAllowance = _mintersAllowance[_msgSender()];
        if (amount > mintAllowance) {
            revert ExceededMintAllowance();
        }

        _mint(account, amount);

        _mintersAllowance[_msgSender()] = mintAllowance - amount;
        emit Mint(_msgSender(), account, amount);

        return true;
    }

    /**
     * @dev Burns tokens in a trusted way.
     * @param amount The amount of tokens to be burned. Must be less
     * than or equal to the token balance of the caller.
     */
    function burn(uint256 amount) external whenNotPaused onlyMinter notBlacklisted(_msgSender()) {
        if (amount == 0) {
            revert ZeroBurnAmount();
        }

        _burn(_msgSender(), amount);

        emit Burn(_msgSender(), amount);
    }
}
