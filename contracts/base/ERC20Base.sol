// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlExtUpgradeable } from "./core/AccessControlExtUpgradeable.sol";
import { RescuableUpgradeable } from "./core/RescuableUpgradeable.sol";
import { PausableExtUpgradeable } from "./core/PausableExtUpgradeable.sol";

import { LegacyCorePlaceholder } from "../legacy/LegacyCorePlaceholder.sol";
import { ERC20Upgradeable } from "../openzeppelin_v4-9-6/ERC20Upgradeable.sol";

/**
 * @title ERC20Base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice This contract is base implementation of the BRLC token with inherited Rescuable,
 * Pausable, and Blocklistable functionality.
 */
abstract contract ERC20Base is
    LegacyCorePlaceholder,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    ERC20Upgradeable
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    // ------------------ Errors ---------------------------------- //

    /// @dev Throws if the zero address is passed to the function
    error ZeroAddress();

    /// @dev Throws if the zero amount is passed to the function
    error ZeroAmount();

    // ------------------ Modifies -------------------------------- //

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkRole(OWNER_ROLE);
        _;
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function __ERC20Base_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __AccessControlExt_init_unchained(); // This is needed only to avoid errors during coverage assessment
        __PausableExt_init(OWNER_ROLE);
        __Rescuable_init(OWNER_ROLE);
        __ERC20_init(name_, symbol_);
        __ERC20Base_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     */
    function __ERC20Base_init_unchained() internal onlyInitializing {
        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @notice Migrates the storage of the contract
     *
     * @dev This function is used to migrate the storage of the contract to the new namespaced storage,
     *      set the OWNER_ROLE role as the admin for itself and other roles,
     *      and grant needed roles to the owner, pauser, and rescuer addresses from the old storage.
     */
    function migrateStorage() external {
        InitializableStorage storage initializableStorage = _getInitializableStorageInternally();
        if (initializableStorage._initialized > 0) {
            return;
        }
        require(_msgSender() == _owner);
        initializableStorage._initialized = uint64(_initialized);
        _initialized = 0;

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(PAUSER_ROLE, OWNER_ROLE);
        _setRoleAdmin(RESCUER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _owner);
        _owner = address(0);
        if (_pauser != address(0)) {
            _grantRole(PAUSER_ROLE, _pauser);
            _pauser = address(0);
        }
        if (_rescuer != address(0)) {
            _grantRole(RESCUER_ROLE, _rescuer);
            _rescuer = address(0);
        }
    }

    // ------------------ View functions -------------------------- //

    /**
     * @notice Returns the old storage variables
     *
     * @dev This function is used to get the following old storage variables:
     *
     * - _initialized;
     * - _owner;
     * - _pauser;
     * - _rescuer.
     */
    function getOldStorageVariables()
        external
        view
        returns (
            uint8 initialized_, // Tools: this comment prevents Prettier from formatting into a single line.
            address owner_,
            address pasuer_,
            address rescuer_
        )
    {
        initialized_ = _initialized;
        owner_ = _owner;
        pasuer_ = _pauser;
        rescuer_ = _rescuer;
    }

    /**
     * @notice Returns the initialized state of the contract in the new storage
     */
    function getNewStorageInitializedState() external view returns (uint256) {
        return _getInitializableStorageInternally()._initialized;
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return super.allowance(owner, spender);
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `owner` address must not be blocklisted
     * @dev The `spender` address must not be blocklisted
     */
    function _approve(
        address owner, // Tools: this comment prevents Prettier from formatting into a single line.
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._approve(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `owner` address must not be blocklisted
     * @dev The `spender` address must not be blocklisted
     */
    function _spendAllowance(
        address owner, // Tools: this comment prevents Prettier from formatting into a single line.
        address spender,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._spendAllowance(owner, spender, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     *
     * @dev The contract must not be paused
     * @dev The `from` address must not be blocklisted
     * @dev The `to` address must not be blocklisted
     */
    function _beforeTokenTransfer(
        address from, // Tools: this comment prevents Prettier from formatting into a single line.
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @inheritdoc ERC20Upgradeable
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
    }

    /**
     * @dev Returns a pointer to the storage namespace of the Initializable parent smart contract.
     */
    function _getInitializableStorageInternally() internal pure returns (InitializableStorage storage $) {
        bytes32 slot = _initializableStorageSlot();
        assembly {
            $.slot := slot
        }
    }
}
