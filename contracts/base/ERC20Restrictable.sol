// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { IERC20Restrictable } from "./interfaces/IERC20Restrictable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Restrictable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports restriction operations
 */
abstract contract ERC20Restrictable is ERC20Base, IERC20Restrictable {
    /// @notice TODO
    bytes32 public constant ANY_ID = bytes32(type(uint256).max);

    /// @notice TODO
    bytes32 private constant OBSOLETE_PURPOSE = hex"fb3d7b70219de002ab2965369568c7492c0ca6cde8075175e3c26888f30d5bf2";

    /// @notice TODO
    uint256 private constant FLAG_INCREASING = 1;

    /// @notice TODO
    uint256 private constant FLAG_DECREASING = 0;

    /// @notice Obsolete. Previously: the mapping of the assigned purposes: receiver => purposes
    mapping(address => bytes32[]) private _purposeAssignments;

    /// @notice The mapping of the total restricted balances: sender => total balance
    mapping(address => uint256) private _totalRestrictedBalances;

    /// @notice Obsolete. Previously: the mapping of the restricted purpose balances: sender => purpose => balance
    mapping(address => mapping(bytes32 => uint256)) private _restrictedPurposeBalances;

    /// @notice TODO sender => receiver => id => balance
    mapping(address => mapping(address => mapping(bytes32 => uint256))) private _restrictedBalances;

    // -------------------- Errors -----------------------------------

    /// @notice TODO
    error IdZero();

    /// @notice TODO
    error IdInvalid();

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
    function restrictionIncrease(address account, bytes32 id, uint256 amount) external onlyBlocklister {
        if (id == OBSOLETE_PURPOSE) {
            address to = _definePixCashierAddress();
            _changeRestriction(account, to, ANY_ID, amount, FLAG_INCREASING);
        } else {
            revert IdInvalid();
        }
    }

    /// @notice TODO
    function restrictionIncrease(address from, address to, bytes32 id, uint256 amount) external onlyBlocklister {
        _changeRestriction(from, to, id, amount, FLAG_INCREASING);
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionDecrease(address account, bytes32 id, uint256 amount) external onlyBlocklister {
        if (id == OBSOLETE_PURPOSE) {
            address to = _definePixCashierAddress();
            _changeRestriction(account, to, ANY_ID, amount, FLAG_DECREASING);
        } else {
            revert IdInvalid();
        }
    }

    /// @notice TODO
    function restrictionDecrease(address from, address to, bytes32 id, uint256 amount) external onlyBlocklister {
        _changeRestriction(from, to, id, amount, FLAG_DECREASING);
    }

    /// @notice TODO
    function transferFromWithId(address from, address to, uint256 amount, bytes32 id) external {
        // TODO add checks

        if (id == bytes32(0)) {
            revert IdZero();
        }
        if (id == ANY_ID) {
            revert IdInvalid();
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
     * @inheritdoc IERC20Restrictable
     */
    function assignedPurposes(address account) external view returns (bytes32[] memory) {
        return _purposeAssignments[account];
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function balanceOfRestricted(address account, bytes32 id) public view returns (uint256) {
        return _balanceOfRestricted(account, _definePixCashierAddress(), id);
    }

    /// @notice TODO
    function balanceOfRestricted(address from, address to, bytes32 id) public view returns (uint256) {
        return _balanceOfRestricted(from, to, id);
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
            _migrateBalance(from, to);
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
    function _balanceOf_ERC20Restrictable(address account) internal view virtual returns (uint256);

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
    function _changeRestriction(address from, address to, bytes32 id, uint256 amount, uint256 flags) private {
        if (from == address(0)) {
            revert ZeroAddress();
        }
        if (to == address(0)) {
            revert ZeroAddress();
        }
        if (id == bytes32(0)) {
            revert IdZero();
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
    function _definePixCashierAddress() private view returns (address) {
        if (block.chainid == 2009) {
            return address(0x1F94A163C329bEc14C73Ca46c66150E3c47dbEDC); // Mainnet
        } else {
            return address(0x3181Ab023a4D4788754258BE5A3b8cf3D8276B98); // Testnet
        }
    }

    /// @dev TODO
    function _migrateBalance(address from, address to) private {
        address pixCashierAddress = _definePixCashierAddress();
        if (to == pixCashierAddress) {
            uint256 purposeAmount = _restrictedPurposeBalances[from][OBSOLETE_PURPOSE];
            if (purposeAmount != 0) {
                _restrictedBalances[from][to][ANY_ID] += purposeAmount;
                _restrictedPurposeBalances[from][OBSOLETE_PURPOSE] = 0;
            }
        }
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[46] private __gap;
}
