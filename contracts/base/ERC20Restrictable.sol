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
    enum PurposeKind {
        Common, // 0
        IdSpecific // 1
    }

    struct PurposeState {
        PurposeKind kind;
        uint64 amountToBeSpent;
    }

    /// @notice The mapping of the assigned purposes: destination account => purposes
    mapping(address => bytes32[]) private _purposeAssignments;

    /// @notice The mapping of the total restricted balances: source account => total balance
    mapping(address => uint256) private _totalRestrictedBalances;

    /// @notice The mapping of the restricted purpose balances: source account => purpose => balance
    mapping(address => mapping(bytes32 => uint256)) private _restrictedPurposeBalances;

    /// @notice TODO
    mapping (bytes32 => PurposeState) private _purposeStates;

    /// @notice source account => purpose => id => balance TODO
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint64))) private _restrictedPurposeWithIdBalances;

    // -------------------- Errors -----------------------------------

    /// @notice Thrown when the zero restriction purpose is passed to the function
    error ZeroPurpose();

    /// @notice Thrown when the transfer amount exceeds the restricted balance
    error TransferExceededRestrictedAmount();

    /// @notice TODO
    error InappropriatePurposeKind();

    /// @notice TODO
    error ZeroId();

    ///

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
    function assignPurposes(address account, bytes32[] memory purposes) external onlyOwner {
        for (uint256 i = 0; i < purposes.length; i++) {
            _checkPurposeNotZero(purposes[i]);
        }

        emit PurposesAssigned(account, purposes, _purposeAssignments[account]);

        _purposeAssignments[account] = purposes;
    }

    /// @dev TODO
    function setPurposeKind(bytes32 purpose, PurposeKind kind) external onlyOwner  {
        _checkPurposeNotZero(purpose);
        _purposeStates[purpose].kind = kind;
        // TODO Events, add to the interface
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionIncrease(address account, bytes32 purpose, uint256 amount) external onlyBlocklister {
        _checkRestrictionChangeParameters(account, purpose, amount);
        _changeCommonRestriction(account, purpose, int256(amount));
    }

    /// @dev TODO
    function restrictionIncreaseWithId(
        address account,
        bytes32 purpose,
        bytes32 id,
        uint256 amount
    ) external onlyBlocklister {
        _checkRestrictionChangeParameters(account, purpose, amount);
        _checkIdNotZero(id);
        int256 change = int256(amount);
        _changeIdSpecificRestriction(account, purpose, id, change);
        _changeCommonRestriction(account, purpose, change);
    }

    /**
     * @inheritdoc IERC20Restrictable
     */
    function restrictionDecrease(address account, bytes32 purpose, uint256 amount) external onlyBlocklister {
        _checkRestrictionChangeParameters(account, purpose, amount);
        _changeCommonRestriction(account, purpose, -int256(amount));
    }

    /// @dev TODO
    function restrictionDecreaseWithId(
        address account,
        bytes32 purpose,
        bytes32 id,
        uint256 amount
    ) external onlyBlocklister {
        _checkRestrictionChangeParameters(account, purpose, amount);
        _checkIdNotZero(id);
        int256 change = -int256(amount);
        _changeIdSpecificRestriction(account, purpose, id, change);
        _changeCommonRestriction(account, purpose, change);
    }

    /// @dev TODO
    function transferFromWithId(address from, address to, uint256 amount, bytes32 id) external {
        // TODO add checks

        if (_totalRestrictedBalances[from] != 0) {
            uint256 purposeAmount = amount;
            bytes32[] storage purposes = _purposeAssignments[to];

            for (uint256 i = 0; i < purposes.length; i++) {
                bytes32 purpose = purposes[i];
                if (_purposeStates[purpose].kind != PurposeKind.IdSpecific) {
                    continue;
                }

                uint256 purposeWithIdBalance = _restrictedPurposeWithIdBalances[from][purpose][id];
                if (purposeWithIdBalance == 0) {
                    continue;
                }
                if (purposeWithIdBalance > purposeAmount) {
                    _purposeStates[purpose].amountToBeSpent = uint64(purposeAmount);
                    purposeWithIdBalance -= purposeAmount;
                    purposeAmount = 0;
                } else {
                    _purposeStates[purpose].amountToBeSpent = uint64(purposeWithIdBalance);
                    purposeAmount -= purposeWithIdBalance;
                    purposeWithIdBalance = 0;
                }
                _restrictedPurposeWithIdBalances[from][purpose][id] = uint64(purposeWithIdBalance);

                if (purposeAmount == 0) {
                    break;
                }
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
    function balanceOfRestricted(address account, bytes32 purpose) public view returns (uint256) {
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
                    PurposeState storage purposeState = _purposeStates[purpose];
                    if (purposeState.kind != PurposeKind.IdSpecific) {
                        if (purposeBalance > purposeAmount) {
                            restrictedBalance -= purposeAmount;
                            purposeBalance -= purposeAmount;
                            purposeAmount = 0;
                        } else {
                            restrictedBalance -= purposeBalance;
                            purposeAmount -= purposeBalance;
                            purposeBalance = 0;
                        }
                    } else {
                        uint256 amountToBeSpent = purposeState.amountToBeSpent;
                        purposeState.amountToBeSpent = 0;
                        restrictedBalance -= amountToBeSpent;
                        purposeBalance -= amountToBeSpent;
                        purposeAmount -= amountToBeSpent;
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


    /// @dev TODO
    function _checkPurposeNotZero(bytes32 purpose) private pure {
        if (purpose == bytes32(0)) {
            revert ZeroPurpose();
        }
    }

    /// @dev TODO
    function _checkPurposeCommon(bytes32 purpose) private view {
        if (_purposeStates[purpose].kind != PurposeKind.Common) {
            revert InappropriatePurposeKind();
        }
    }

    /// @dev TODO
    function _checkRestrictionChangeParameters(address account, bytes32 purpose, uint256 amount) private view {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        _checkPurposeNotZero(purpose);
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (amount > type(uint64).max) {
            revert InappropriateUint64Value(amount);
        }
        _checkPurposeCommon(purpose);
    }

    /// @dev TODO
    function _checkIdNotZero(bytes32 id) private pure {
        if (id == bytes32(0)) {
            revert ZeroId();
        }
    }

    /// @dev TODO
    function _changeCommonRestriction(address account, bytes32 purpose, int256 change) private {
        uint256 oldBalance = _restrictedPurposeBalances[account][purpose];

        uint256 newBalance;
        if (change >= 0) {
            uint256 amount = uint256(change);
            _totalRestrictedBalances[account] += amount;
            newBalance = oldBalance + amount;
        } else {
            uint256 amount = uint256(-change);
            _totalRestrictedBalances[account] -= amount;
            newBalance = oldBalance - amount;
        }
        _restrictedPurposeBalances[account][purpose] = newBalance;

        emit RestrictionUpdated(account, purpose, newBalance, oldBalance);
    }

    /// @dev TODO
    function _changeIdSpecificRestriction(address account, bytes32 purpose, bytes32 id, int256 change) private {
        uint64 oldBalance = _restrictedPurposeWithIdBalances[account][purpose][id];

        uint64 newBalance;
        if (change >= 0) {
            uint64 amount = uint64(uint256(change));
            newBalance = oldBalance + amount;
        } else {
            uint64 amount = uint64(uint256(-change));
            newBalance = oldBalance - amount;
        }
        _restrictedPurposeWithIdBalances[account][purpose][id] = newBalance;

        emit IdSpecificRestrictionUpdated(account, purpose, id, newBalance, oldBalance);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[45] private __gap;
}
