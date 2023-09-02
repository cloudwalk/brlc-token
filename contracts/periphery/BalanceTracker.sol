// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IBalanceTracker } from "./../base/interfaces/periphery/IBalanceTracker.sol";
import { IERC20Hook } from "./../base/interfaces/IERC20Hook.sol";

/**
 * @title BalanceTracker contract
 * @author CloudWalk Inc.
 * @notice The contract that keeps track of the token balance for each account on a daily basis
 */
contract BalanceTracker is OwnableUpgradeable, IBalanceTracker, IERC20Hook {
    /// @notice The time shift of a day in seconds
    uint256 public constant NEGATIVE_TIME_SHIFT = 3 hours;

    /// @notice The address of the hooked token contract
    address public constant TOKEN = address(0x0);

    /**
     * @notice The day-value pair
     *
     * @param day The index of the day
     * @param value The value associated with the day
     */
    struct Record {
        uint16 day;
        uint240 value;
    }

    /// @notice The index of the initialization day
    uint16 public INITIALIZATION_DAY;

    /// @notice The mapping of an account to daily balance records
    mapping(address => Record[]) public _balanceRecords;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when a new balance record is created
     *
     * @param account The address of the account
     * @param day The index of the day
     * @param balance The balance associated with the day
     */
    event BalanceRecordCreated(address indexed account, uint16 day, uint240 balance);

    // -------------------- Errors -----------------------------------

    /**
     * @notice Thrown when the specified day is invalid (or not tracked)
     *
     * @param message The error message
     */
    error InvalidDay(string message);

    /**
     * @notice Thrown when the value does not fit in the specified type
     *
     * @param message The error message
     */
    error SafeCastOverflow(string message);

    /**
     * @notice Thrown when the caller is not the token contract
     *
     * @param account The address of the caller
     */
    error UnauthorizedCaller(address account);

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the token contract
     */
    modifier onlyToken() {
        if (_msgSender() != TOKEN) {
            revert UnauthorizedCaller(_msgSender());
        }
        _;
    }

    // -------------------- Initializers -----------------------------

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
     */
    function initialize() external virtual initializer {
        __BalanceTracker_init();
    }

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See {BalanceTracker-initialize}
     */
    function __BalanceTracker_init() internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __BalanceTracker_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {BalanceTracker-initialize}
     */
    function __BalanceTracker_init_unchained() internal onlyInitializing {
        (uint256 day, ) = dayAndTime();
        INITIALIZATION_DAY = _toUint16(day);
        IERC20Upgradeable(TOKEN).totalSupply();
    }

    // -------------------- Hook Functions ---------------------------

    /**
     * @inheritdoc IERC20Hook
     *
     * @dev Can only be called by the hooked token contract
     * @dev Emits an {BalanceRecordCreated} event for `from` account
     * @dev Emits an {BalanceRecordCreated} event for `to` account
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external override onlyToken {
        if (amount == 0) return;

        (uint256 day, ) = dayAndTime();
        if (day-- == INITIALIZATION_DAY) {
            return;
        }

        // Update `from` balances and create a new record for the past period if needed
        if (
            from != address(0) &&
            (_balanceRecords[from].length == 0 || _balanceRecords[from][_balanceRecords[from].length - 1].day < day)
        ) {
            uint240 balance = _toUint240(IERC20Upgradeable(TOKEN).balanceOf(from) + amount);
            _balanceRecords[from].push(Record({ day: _toUint16(day), value: balance }));
            emit BalanceRecordCreated(from, _toUint16(day), balance);
        }

        // Update `to` balances and create a new record for the past period if needed
        if (
            to != address(0) &&
            (_balanceRecords[to].length == 0 || _balanceRecords[to][_balanceRecords[to].length - 1].day < day)
        ) {
            uint240 balance = _toUint240(IERC20Upgradeable(TOKEN).balanceOf(to) - amount);
            _balanceRecords[to].push(Record({ day: _toUint16(day), value: balance }));
            emit BalanceRecordCreated(to, _toUint16(day), balance);
        }
    }

    /**
     * @inheritdoc IERC20Hook
     *
     * @dev Can only be called by the hooked token contract
     * @dev Emits an {BalanceRecordCreated} event for `from` account
     * @dev Emits an {BalanceRecordCreated} event for `to` account
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external override onlyToken {}

    // -------------------- View Functions ---------------------------

    /**
     * @notice Reads the balance record array
     *
     * @param index The index of the record to read
     * @return The record at the specified index and the length of array
     */
    function readBalanceRecord(address account, uint256 index) external view returns (Record memory, uint256) {
        return (_balanceRecords[account][index], _balanceRecords[account].length);
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function getDailyBalances(
        address account,
        uint256 fromDay,
        uint256 toDay
    ) external view returns (uint256[] memory) {
        if (fromDay < INITIALIZATION_DAY) {
            revert InvalidDay("The `from` day must be greater than or equal to the initialization day");
        }
        if (fromDay > toDay) {
            revert InvalidDay("The `from` day must be less than or equal to the `to` day");
        }

        uint16 day = 0;
        uint256 balance = 0;
        uint256 recordIndex = _balanceRecords[account].length - 1;
        if (toDay >= _balanceRecords[account][recordIndex].day) {
            /**
             * The `to` day is ahead or equal to the last record day
             * Therefore get the actual balance of the account directly from
             * the token contract and set the `day` variable to the last record day
             */
            balance = IERC20Upgradeable(TOKEN).balanceOf(account);
            day = _balanceRecords[account][recordIndex].day;
        } else {
            /**
             * The `to` day is behind the last record day
             * Therefore find the record with a day that is ahead of the `to` day
             * and set the `balance` variable to the value of that record
             */
            while (_balanceRecords[account][--recordIndex].day > toDay) {}
            balance = _balanceRecords[account][recordIndex + 1].value;
            day = _balanceRecords[account][recordIndex].day;
        }

        /**
         * Iterate over the records from the `to` day to the `from` day
         * and fill the `balances` array with the daily balances
         */
        uint256 i = toDay + 1 - fromDay;
        uint256 dayIndex = fromDay + i;
        uint256[] memory balances = new uint256[](i);
        do {
            i--;
            dayIndex--;
            if (dayIndex == day) {
                balance = _balanceRecords[account][recordIndex].value;
                if (recordIndex != 0) {
                    day = _balanceRecords[account][--recordIndex].day;
                }
            }
            balances[i] = balance;
        } while (i > 0);

        return balances;
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function dayAndTime() public view override returns (uint256, uint256) {
        uint256 timestamp = _blockTimestamp();
        return (timestamp / 1 days, timestamp % 1 days);
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function token() external pure override returns (address) {
        return TOKEN;
    }

    // -------------------- Internal Functions -----------------------

    /**
     * @notice Returns the current block timestamp with the time shift
     */
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp - NEGATIVE_TIME_SHIFT;
    }

    /**
     * @dev Returns the downcasted uint240 from uint256, reverting on
     * overflow (when the input is greater than largest uint240)
     */
    function _toUint240(uint256 value) internal pure returns (uint240) {
        if (value > type(uint240).max) {
            revert SafeCastOverflow("The value does not fit in uint240");
        }

        return uint240(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16)
     */
    function _toUint16(uint256 value) internal pure returns (uint16) {
        if (value > type(uint16).max) {
            revert SafeCastOverflow("The value does not fit in uint16");
        }

        return uint16(value);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[48] private __gap;
}
