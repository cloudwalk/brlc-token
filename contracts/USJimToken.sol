// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { ERC20Base } from "./base/ERC20Base.sol";
import { ERC20Mintable } from "./base/ERC20Mintable.sol";
import { ERC20Freezable } from "./base/ERC20Freezable.sol";

/**
 * @title USJimToken contract
 * @author CloudWalk Inc.
 * @notice The USJim token implementation that supports minting, burning and freezing operations
 */
contract USJimToken is ERC20Base, ERC20Mintable, ERC20Freezable {
    /**
     * @notice Constructor that prohibits the initialization of the implementation of the upgradable contract
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice The initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) external virtual initializer {
        __USJimToken_init(name_, symbol_);
    }

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See {USJimToken-initialize}
     */
    function __USJimToken_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Mintable_init_unchained();
        __ERC20Freezable_init_unchained();
        __USJimToken_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {USJimToken-initialize}
     */
    function __USJimToken_init_unchained() internal onlyInitializing {}

    /**
     * @notice Returns true if token is USJim implementation
     */
    function isUSJim() external pure returns (bool) {
        return true;
    }

    /**
     * @dev See {ERC20Base-_beforeTokenTransfer}
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20Base) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev See {ERC20Base-_afterTokenTransfer}
     * @dev See {ERC20Freezable-_afterTokenTransfer}
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Base, ERC20Freezable, ERC20Mintable) {
        super._afterTokenTransfer(from, to, amount);
    }

    /**
     * @inheritdoc ERC20Mintable
     */
    function _balanceOf_ERC20Mintable(address account, address recipient) internal view virtual override returns (uint256) {
        return balanceOf(account) -  balanceOfFrozen(account);
    }

    /**
     * @inheritdoc ERC20Freezable
     */
    function _balanceOf_ERC20Freezable(address account, address recipient) internal view virtual override returns (uint256) {
        return balanceOf(account) - balanceOfPremint(account);
    }
}
