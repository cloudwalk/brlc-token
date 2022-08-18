// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { RescuableUpgradeable } from "../base/RescuableUpgradeable.sol";
import { PausableExUpgradeable } from "../base/PausableExUpgradeable.sol";
import { BlacklistableUpgradeable } from "../base/BlacklistableUpgradeable.sol";

/**
 * @title BRLCTokenUpgradeable base contract
 */
abstract contract BRLCTokenUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    BlacklistableUpgradeable,
    ERC20Upgradeable
{
    function __BRLCToken_init(string memory name_, string memory symbol_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCToken_init_unchained();
    }

    function __BRLCToken_init_unchained() internal initializer {}

    /**
     * @dev ERC20 `decimals` function.
     */
    function decimals() public view override returns (uint8) {
        return 6;
    }

    /**
     * @dev ERC20 `transfer` function.
     */
    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        whenNotPaused
        notBlacklisted(_msgSender())
        notBlacklisted(recipient)
        returns (bool)
    {
        return super.transfer(recipient, amount);
    }

    /**
     * @dev ERC20 `approve` function.
     */
    function approve(address spender, uint256 amount)
        public
        virtual
        override
        whenNotPaused
        notBlacklisted(_msgSender())
        notBlacklisted(spender)
        returns (bool)
    {
        return super.approve(spender, amount);
    }

    /**
     * @dev ERC20 `transferFrom` function.
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override whenNotPaused notBlacklisted(sender) notBlacklisted(recipient) returns (bool) {
        return super.transferFrom(sender, recipient, amount);
    }

    function increaseAllowance(address spender, uint256 addedValue)
        public
        virtual
        override
        whenNotPaused
        notBlacklisted(_msgSender())
        notBlacklisted(spender)
        returns (bool)
    {
        return super.increaseAllowance(spender, addedValue);
    }

    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        virtual
        override
        whenNotPaused
        notBlacklisted(_msgSender())
        notBlacklisted(spender)
        returns (bool)
    {
        return super.decreaseAllowance(spender, subtractedValue);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        require(!paused(), "ERC20Pausable: token transfer while paused");
    }
}
