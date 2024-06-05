// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { IERC20Referenceable } from "./interfaces/IERC20Referenceable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Referenceable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports referenced operations
 */
abstract contract ERC20Referenceable is ERC20Base, IERC20Referenceable {
    /// @notice The mapping of the referenced amounts: account => id => amount
    mapping(address => mapping(bytes32 => uint64)) internal _referencedAmounts;

    /// @notice The mapping of the total referenced amounts per account: account => amount
    mapping(address => uint256) internal _totalReferencedFromAccount;

    /// @notice The mapping reference admins to their status: account => status
    mapping(address => bool) internal _referenceAdmins;

    /**
     * @notice Error thrown when an invalid reference ID is provided
     */
    error InvalidReferenceId();

    /**
     * @notice Error thrown when the transfer amount exceeds the referenced amount
     */
    error TransferExceededReferencedAmount();

    /**
     * @notice Error thrown when the caller is not a reference admin
     */
    error UnauthorizedReferenceAdmin();

    /**
     * @notice Error thrown when the zero reference ID is provided
     */
    error ZeroReferenceId();

    /**
     * @notice Error thrown when the value doesn't fit in an uint of `bits` size.
     */
    error SafeCastOverflowedUintDowncast(uint8 bits, uint256 value);

    /**
     * @notice Modifier to restrict access to reference admin only
     */
    modifier onlyReferenceAdmin() {
        if (!_referenceAdmins[msg.sender]) {
            revert UnauthorizedReferenceAdmin();
        }
        _;
    }

    /**
     * @inheritdoc IERC20Referenceable
     *
     * @dev Can only be called by the owner account
     * @dev The account must not be already configured
     * @dev The account must not be zero address
     */
    function configureReferenceAdmin(address account, bool status) external onlyOwner {
        if (account == address (0)) {
            revert ZeroAddress();
        }
        if (_referenceAdmins[account] == status) {
            revert AlreadyConfigured();
        }

        _referenceAdmins[account] = status;

        emit ReferenceAdminConfigured(account, status);
    }

    /**
     * @inheritdoc IERC20Referenceable
     *
     * @dev Can be called by the reference admin
     * @dev The id must not be zero
     * @dev The account must not be zero
     * @dev The amount must not be zero
     */
    function createReference(bytes32 id, address account, uint256 amount) external onlyReferenceAdmin {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (id == bytes32(0)) {
            revert ZeroReferenceId();
        }

        _referencedAmounts[account][id] = toUint64(amount);
        _totalReferencedFromAccount[account] += amount;

        emit ReferenceCreated(id, account, amount);
    }

    /**
     * @inheritdoc IERC20Referenceable
     *
     * @dev Can be called by the reference admin
     * @dev The id must not be zero
     * @dev The account must not be zero
     * @dev The amount must not be zero
     */
    function updateReference(bytes32 id, address account, uint256 newAmount) external onlyReferenceAdmin {
        if (newAmount == 0) {
            revert ZeroAmount();
        }
        if (id == bytes32(0)) {
            revert ZeroReferenceId();
        }

        uint64 oldAmount = _referencedAmounts[account][id];

        if (oldAmount == 0) {
            revert InvalidReferenceId();
        }

        _totalReferencedFromAccount[account] -= oldAmount;
        _referencedAmounts[account][id] = toUint64(newAmount);
        _totalReferencedFromAccount[account] += newAmount;

        emit ReferenceUpdated(id, newAmount, oldAmount);
    }

    /**
     * @inheritdoc IERC20Referenceable
     *
     * @dev The id must not be zero
     * @dev The amount must not be zero
     */
    function transferFromWithId(
        address sender,
        address receiver,
        uint256 amount,
        bytes32 id
    ) external onlyReferenceAdmin {
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (id == bytes32(0)) {
            revert ZeroReferenceId();
        }

        _referencedAmounts[sender][id] -= toUint64(amount);
        transferFrom(sender, receiver, amount);
        emit TransferWithId(id, sender, receiver, amount);
    }

    /**
     * @inheritdoc IERC20Referenceable
     */
    function getAccountReferencesById(address account, bytes32 id) external view returns (uint256) {
        return _referencedAmounts[account][id];
    }

    /**
     * @inheritdoc IERC20Referenceable
     */
    function balanceOfReferenced(address account) public view returns (uint256) {
        return _totalReferencedFromAccount[account];
    }

    /**
     * @inheritdoc ERC20Base
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        // Execute basic transfer logic
        super._afterTokenTransfer(from, to, amount);

        uint256 totalReferencedBalance = _totalReferencedFromAccount[from];
        if (totalReferencedBalance != 0) {
            if (_balanceOf_ERC20Referenceable(from) < totalReferencedBalance) {
                revert TransferExceededReferencedAmount();
            }
        }
    }

    /**
     * @dev Internal function to convert uint256 to uint64
     */
    function toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) {
            revert SafeCastOverflowedUintDowncast(64, value);
        }
        return uint64(value);
    }

    /**
     * @notice Returns the transferable amount of tokens owned by account
     *
     * @param account The account to get the balance of
     */
    function _balanceOf_ERC20Referenceable(address account) internal view virtual returns (uint256);

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[47] private __gap;
}