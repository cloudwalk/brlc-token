// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20Detailed} from "../base/interfaces/IERC20Detailed.sol";
import {IERC20Wrapper} from "../base/interfaces/IERC20Wrapper.sol";

/**
 * @title BRLCWrapperUpgradeable contract
 * @dev Extension of the ERC20 token contract to support token wrapping.
 */
contract BRLCWrapperUpgradeable is
    OwnableUpgradeable,
    ERC20Upgradeable,
    IERC20Wrapper
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable private _underlying;

    function initialize(
        string memory name_,
        string memory symbol_,
        address underlying_
    ) public initializer {
        __BRLCWrapper_init(name_, symbol_, underlying_);
    }

    function __BRLCWrapper_init(
        string memory name_,
        string memory symbol_,
        address underlying_
    ) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCWrapper_init_unchained(underlying_);
    }

    function __BRLCWrapper_init_unchained(address underlying_)
        internal
        initializer
    {
        require(underlying_ != address(0), "!underlying_");
        _setupDecimals(IERC20Detailed(underlying_).decimals());
        _underlying = IERC20Upgradeable(underlying_);
    }

    /**
     * @dev Flag function to check if contract implements IERC20Wrapper interface.
     * @return true if contract implements IERC20Wrapper interface.
     */
    function isIERC20Wrapper() external pure override returns (bool) {
        return true;
    }

    /**
     * @dev Allows the owner to wrap underlying tokens.
     * @param account The owner of underlying tokens.
     * @param amount Amount of tokens to wrap.
     * @return true if warp was successful.
     */
    function wrapFor(address account, uint256 amount)
        external
        override
        onlyOwner
        returns (bool)
    {
        _underlying.safeTransferFrom(account, address(this), amount);
        _mint(account, amount);
        return true;
    }

    /**
     * @dev Allows the owner to unwrap underlying tokens.
     * @param account The owner of underlying tokens.
     * @param amount Amount of tokens to unwrap.
     * @return true if unwrap was successful.
     */
    function unwrapFor(address account, uint256 amount)
        external
        override
        onlyOwner
        returns (bool)
    {
        _burn(account, amount);
        _underlying.safeTransfer(account, amount);
        return true;
    }

    /**
     * @dev Returns underlying token address.
     */
    function underlying() external view override returns (address) {
        return address(_underlying);
    }
}
