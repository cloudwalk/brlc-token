// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { IERC20Restrictable } from "./interfaces/IERC20Restrictable.sol";
import { IERC20RestrictableV2 } from "./interfaces/IERC20Restrictable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Restrictable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports restriction operations
 */
abstract contract ERC20Restrictable is ERC20Base, IERC20Restrictable {
    /// @notice The mapping of the assigned purposes: account => purposes
    mapping(address => bytes32[]) internal _purposeAssignments;

    /// @notice The mapping of the total restricted balances: account => total balance
    mapping(address => uint256) internal _totalRestrictedBalances;

    /// @notice The mapping of the restricted purpose balances: account => purpose => balance
    mapping(address => mapping(bytes32 => uint256)) internal _restrictedPurposeBalances;

    /// @notice The mapping of the restricted balances: sender => receiver => id => balance
    mapping(address => mapping(address => mapping(bytes32 => uint256))) internal _restrictedBalances;

    // -------------------- Errors -----------------------------------

    /// @notice Thrown when the zero restriction purpose is passed to the function
    error ZeroPurpose();

    /// @notice Thrown when the transfer amount exceeds the restricted balance
    error TransferExceededRestrictedAmount();

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __ERC20Restrictable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Restrictable_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     */
    function __ERC20Restrictable_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IERC20Restrictable
     */
    function assignPurposes(address account, bytes32[] memory purposes) external virtual onlyOwner {
        for (uint256 i = 0; i < purposes.length; i++) {
            if (purposes[i] == bytes32(0)) {
                revert ZeroPurpose();
            }
        }

        emit PurposesAssigned(account, purposes, _purposeAssignments[account]);

        _purposeAssignments[account] = purposes;
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionIncrease(address account, bytes32 purpose, uint256 amount) external virtual onlyBlocklister {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (purpose == bytes32(0)) {
            revert ZeroPurpose();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 oldBalance = _restrictedPurposeBalances[account][purpose];
        uint256 newBalance = oldBalance + amount;

        _restrictedPurposeBalances[account][purpose] = newBalance;
        _totalRestrictedBalances[account] += amount;

        emit RestrictionUpdated(account, purpose, newBalance, oldBalance);
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionDecrease(address account, bytes32 purpose, uint256 amount) external virtual onlyBlocklister {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (purpose == bytes32(0)) {
            revert ZeroPurpose();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 oldBalance = _restrictedPurposeBalances[account][purpose];
        uint256 newBalance = oldBalance - amount;

        _restrictedPurposeBalances[account][purpose] = newBalance;
        _totalRestrictedBalances[account] -= amount;

        emit RestrictionUpdated(account, purpose, newBalance, oldBalance);
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function assignedPurposes(address account) external view returns (bytes32[] memory) {
        return _purposeAssignments[account];
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function balanceOfRestricted(address account, bytes32 purpose) public virtual view returns (uint256) {
        if (purpose == bytes32(0)) {
            return _totalRestrictedBalances[account];
        } else {
            return _restrictedPurposeBalances[account][purpose];
        }
    }

    /**
     * @inheritdoc ERC20Base
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        // Execute basic transfer logic
        super._afterTokenTransfer(from, to, amount);

        // Execute restricted transfer logic
        uint256 restrictedBalance = _totalRestrictedBalances[from];
        if (restrictedBalance != 0) {
            uint256 purposeAmount = amount;
            bytes32[] memory purposes = _purposeAssignments[to];

            for (uint256 i = 0; i < purposes.length; i++) {
                bytes32 purpose = purposes[i];
                uint256 purposeBalance = _restrictedPurposeBalances[from][purpose];

                if (purposeBalance != 0) {
                    if (purposeBalance > purposeAmount) {
                        restrictedBalance -= purposeAmount;
                        purposeBalance -= purposeAmount;
                        purposeAmount = 0;
                    } else {
                        restrictedBalance -= purposeBalance;
                        purposeAmount -= purposeBalance;
                        purposeBalance = 0;
                    }
                    _restrictedPurposeBalances[from][purpose] = purposeBalance;
                }

                if (purposeAmount == 0) {
                    break;
                }
            }

            if (_balanceOf_ERC20Restrictable(from) < restrictedBalance) {
                revert TransferExceededRestrictedAmount();
            }

            _totalRestrictedBalances[from] = restrictedBalance;
        }
    }

    /**
     * @notice Returns the transferable amount of tokens owned by account
     *
     * @param account The account to get the balance of
     */
    function _balanceOf_ERC20Restrictable(address account) internal view virtual returns (uint256);

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[46] private __gap;
}

/**
 * @title ERC20RestrictableV2 contract
 * @author CloudWalk Inc.
 * @notice TODO
 */
abstract contract ERC20RestrictableV2 is ERC20Restrictable, IERC20RestrictableV2 {
    /// @notice TODO
    bytes32 private constant OBSOLETE_PURPOSE = hex"fb3d7b70219de002ab2965369568c7492c0ca6cde8075175e3c26888f30d5bf2";

    /// @notice TODO
    bytes32 public constant ANY_ID = bytes32(type(uint256).max);

    /// @notice TODO
    uint256 private constant FLAG_INCREASING = 1;

    /// @notice TODO
    uint256 private constant FLAG_DECREASING = 0;

    // -------------------- Errors -----------------------------------

    /// @notice TODO
    error ZeroId();

    /// @notice TODO
    error InvalidId();

    /// @notice TODO
    error Obsolate();

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __ERC20RestrictableV2_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Restrictable_init_unchained();
        __ERC20RestrictableV2_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     */
    function __ERC20RestrictableV2_init_unchained() internal onlyInitializing {}

    // -------------------- Functions V1 -----------------------------

    /**
     * @inheritdoc IERC20Restrictable
     */
    function assignPurposes(address account, bytes32[] memory purposes) external override onlyOwner {
        revert Obsolate();
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionIncrease(address account, bytes32 id, uint256 amount) external override onlyBlocklister {
        if (id == OBSOLETE_PURPOSE) {
            address to = _defineObsolatePurposeAddress();
            _changeRestriction(account, to, amount, ANY_ID, FLAG_INCREASING);
        } else {
            revert InvalidId();
        }
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionDecrease(address account, bytes32 id, uint256 amount) external override onlyBlocklister {
        if (id == OBSOLETE_PURPOSE) {
            address to = _defineObsolatePurposeAddress();
            _changeRestriction(account, to, amount, ANY_ID, FLAG_DECREASING);
        } else {
            revert InvalidId();
        }
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function balanceOfRestricted(address account, bytes32 id) public override view returns (uint256) {
        return _balanceOfRestricted(account, _defineObsolatePurposeAddress(), id);
    }

    // -------------------- Functions V2 -----------------------------

    /**
     * @inheritdoc IERC20RestrictableV2
     */
    function restrictionIncrease(address from, address to, uint256 amount, bytes32 id) external onlyBlocklister {
        _changeRestriction(from, to, amount, id, FLAG_INCREASING);
    }

    /**
     * @inheritdoc IERC20RestrictableV2
     */
    function restrictionDecrease(address from, address to, uint256 amount, bytes32 id) external onlyBlocklister {
        _changeRestriction(from, to, amount, id, FLAG_DECREASING);
    }

    /**
     * @inheritdoc IERC20RestrictableV2
     */
    function transferRestricted(address from, address to, uint256 amount, bytes32 id) external onlyBlocklister {
        // TODO add checks

        if (id == bytes32(0)) {
            revert ZeroId();
        }
        if (id == ANY_ID) {
            revert InvalidId();
        }

        if (_totalRestrictedBalances[from] != 0) {
            uint256 oldRestrictedBalanceSpecific = _restrictedBalances[from][to][id];
            if (oldRestrictedBalanceSpecific != 0) {
                uint256 newRestrictedBalanceSpecific = oldRestrictedBalanceSpecific;
                uint256 oldRestrictedBalanceCommon = _restrictedBalances[from][to][ANY_ID];
                uint256 newRestrictedBalanceCommon = oldRestrictedBalanceCommon;
                if (newRestrictedBalanceSpecific > amount) {
                    newRestrictedBalanceCommon += amount;
                    newRestrictedBalanceSpecific -= amount;
                } else {
                    newRestrictedBalanceCommon += newRestrictedBalanceSpecific;
                    newRestrictedBalanceSpecific = 0;
                }
                uint256 restrictedBalanceTotal = _totalRestrictedBalances[from];
                emit RestrictionChanged(
                    from,
                    to,
                    id,
                    newRestrictedBalanceSpecific,
                    oldRestrictedBalanceSpecific,
                    restrictedBalanceTotal,
                    restrictedBalanceTotal
                );
                emit RestrictionChanged(
                    from,
                    to,
                    ANY_ID,
                    newRestrictedBalanceCommon,
                    oldRestrictedBalanceCommon,
                    restrictedBalanceTotal,
                    restrictedBalanceTotal
                );
                _restrictedBalances[from][to][id] = newRestrictedBalanceSpecific;
                _restrictedBalances[from][to][ANY_ID] = newRestrictedBalanceCommon;
            }
        }

        transferFrom(from, to, amount);
    }

    /**
     * @inheritdoc IERC20RestrictableV2
     */
    function balanceOfRestricted(address from, address to, bytes32 id) public view returns (uint256) {
        return _balanceOfRestricted(from, to, id);
    }

    /// @dev TODO
    function migrateBalance(address from, address to) public {
        address obsolatePurposeAddress = _defineObsolatePurposeAddress();
        if (to == obsolatePurposeAddress) {
            uint256 purposeAmount = _restrictedPurposeBalances[from][OBSOLETE_PURPOSE];
            if (purposeAmount != 0) {
                _restrictedBalances[from][to][ANY_ID] += purposeAmount;
                _restrictedPurposeBalances[from][OBSOLETE_PURPOSE] = 0;
            }
        }
    }

    /**
     * @inheritdoc ERC20Base
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        // Execute basic transfer logic
        super._afterTokenTransfer(from, to, amount);

        // Execute restricted transfer logic
        uint256 oldRestrictedBalanceTotal = _totalRestrictedBalances[from];
        if (oldRestrictedBalanceTotal != 0) {
            uint256 newRestrictedBalanceTotal = oldRestrictedBalanceTotal;
            migrateBalance(from, to);
            uint256 oldRestrictedBalanceSpecific = _restrictedBalances[from][to][ANY_ID];

            if (oldRestrictedBalanceSpecific != 0) {
                uint256 newRestrictedBalanceSpecific = oldRestrictedBalanceSpecific;
                if (newRestrictedBalanceSpecific > amount) {
                    newRestrictedBalanceTotal -= amount;
                    newRestrictedBalanceSpecific = oldRestrictedBalanceSpecific - amount;
                } else {
                    newRestrictedBalanceTotal -= oldRestrictedBalanceSpecific;
                    newRestrictedBalanceSpecific = 0;
                }
                _restrictedBalances[from][to][ANY_ID] = newRestrictedBalanceSpecific;
                emit RestrictionChanged(
                    from,
                    to,
                    ANY_ID,
                    newRestrictedBalanceSpecific,
                    oldRestrictedBalanceSpecific,
                    newRestrictedBalanceTotal,
                    oldRestrictedBalanceTotal
                );
            }

            if (_balanceOf_ERC20Restrictable(from) < newRestrictedBalanceTotal) {
                revert TransferExceededRestrictedAmount();
            }

            _totalRestrictedBalances[from] = newRestrictedBalanceTotal;
        }
    }

    /**
     * @notice Returns the transferable amount of tokens owned by account
     *
     * @param account The account to get the balance of
     */
    function _balanceOf_ERC20Restrictable(address account) internal view virtual override returns (uint256);

    /// @notice TODO
    function _balanceOfRestricted(address from, address to, bytes32 id) internal view returns (uint256) {
        if (id == bytes32(0) || to == address(0)) {
            return _totalRestrictedBalances[from];
        } else {
            if (id == OBSOLETE_PURPOSE) {
                return _restrictedPurposeBalances[from][id];
            } else {
                return _restrictedBalances[from][to][id];
            }
        }
    }

    /// @notice TODO
    function _changeRestriction(address from, address to, uint256 amount, bytes32 id, uint256 flags) private {
        if (from == address(0)) {
            revert ZeroAddress();
        }
        if (to == address(0)) {
            revert ZeroAddress();
        }
        if (id == bytes32(0)) {
            revert ZeroId();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 oldBalanceSpecific = _restrictedBalances[from][to][id];
        uint256 oldBalanceTotal = _totalRestrictedBalances[from];
        uint256 newBalanceSpecific = oldBalanceSpecific;
        uint256 newBalanceTotal = oldBalanceTotal;

        if (flags & FLAG_INCREASING != 0) {
            newBalanceSpecific += amount;
            newBalanceTotal += amount;
        } else {
            newBalanceSpecific -= amount;
            newBalanceTotal -= amount;
        }

        _restrictedBalances[from][to][id] = newBalanceSpecific;
        _totalRestrictedBalances[from] = newBalanceTotal;

        emit RestrictionChanged(
            from,
            to,
            id,
            newBalanceSpecific,
            oldBalanceSpecific,
            newBalanceTotal,
            oldBalanceTotal
        );
    }

    /// @dev TODO
    function _defineObsolatePurposeAddress() internal virtual view returns (address) {
        if (block.chainid == 2009) {
            return address(0x1F94A163C329bEc14C73Ca46c66150E3c47dbEDC); // Mainnet
        } else {
            return address(0x3181Ab023a4D4788754258BE5A3b8cf3D8276B98); // Testnet
        }
    }
}
