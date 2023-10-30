// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Restrictable } from "./interfaces/IERC20Restrictable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Restrictable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports restriction operations
 */
abstract contract ERC20Restrictable is ERC20Base, IERC20Restrictable {
    /// @notice The mapping of the assigned purposes: account => purposes
    mapping(address => bytes32[]) private _purposeAssignments;

    /// @notice The mapping of the total restricted balances: account => total balance
    mapping(address => uint256) private _totalRestrictedBalances;

    /// @notice The mapping of the restricted purpose balances: account => purpose => balance
    mapping(address => mapping(bytes32 => uint256)) private _restrictedPurposeBalances;

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
        __Blacklistable_init_unchained();
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
    function assignPurposes(address account, bytes32[] memory purposes) external onlyOwner {
        for (uint256 i = 0; i < purposes.length; i++) {
            if (purposes[i] == bytes32(0)) {
                revert ZeroPurpose();
            }
        }

        emit AssignPurposes(account, purposes, _purposeAssignments[account]);

        _purposeAssignments[account] = purposes;
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function updateRestriction(address account, bytes32 purpose, uint256 balance) external onlyBlacklister {
        if (purpose == bytes32(0)) {
            revert ZeroPurpose();
        }

        uint256 oldBalance = _restrictedPurposeBalances[account][purpose];
        _restrictedPurposeBalances[account][purpose] = balance;

        if (oldBalance > balance) {
            _totalRestrictedBalances[account] -= oldBalance - balance;
        } else {
            _totalRestrictedBalances[account] += balance - oldBalance;
        }

        emit UpdateRestriction(account, purpose, balance, oldBalance);
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
    function balanceOfRestricted(address account, bytes32 purpose) external view returns (uint256) {
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
                        purposeBalance = 0;
                        purposeAmount -= purposeBalance;
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
    uint256[47] private __gap;
}
