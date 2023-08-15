// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IERC20Hook } from "./../base/interfaces/IERC20Hook.sol";

contract BalanceTracker is OwnableUpgradeable, IERC20Hook {
    /**
     * @notice The duration of a day in seconds
     */
    uint256 public constant DAY = 1 days;

    /**
     * @notice The time shift of a day in seconds
     */
    uint256 public constant NEGATIVE_TIME_SHIFT = 3 hours;

    /**
     * @notice The address of the hooked token contract
     */
    address public constant TOKEN = address(0x0);

    /**
     * @notice The index of the initialization day
     */
    uint16 public INITIALIZATION_DAY;

    /**
     * @notice The day-value pair record
     * @param day The index of the day
     * @param value The value
     */
    struct Record {
        uint16 day;
        uint240 value;
    }

    /**
     * @notice The mapping of an account to daily balance records
     */
    mapping(address => Record[]) public _balanceRecords;

    /**
     * @notice Thrown when the specified day is invalid or untracked
     */
    error InvalidDay();

    /**
     * @notice Thrown when the specified value is too large to fit in the specified type
     */
    error SafeCastOverflow();

    /**
     * @notice Thrown when the caller is not the token contract
     * @param account The address of the caller
     */
    error UnauthorizedCaller(address account);

    /**
     * @notice Emitted when a new balance record is created
     * @param account The address of the account
     * @param day The index of the day
     * @param balance The balance
     */
    event BalanceRecordCreated(address indexed account, uint16 day, uint240 balance);

    /**
     * @notice Throws if called by any account other than the token contract
     */
    modifier onlyToken() {
        if (_msgSender() != TOKEN) {
            revert UnauthorizedCaller(_msgSender());
        }
        _;
    }

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
        IERC20Upgradeable(TOKEN).totalSupply(); // TOKEN must be set
        INITIALIZATION_DAY = currentDayIndex();
    }

    /**
     * @inheritdoc IERC20Hook
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external override onlyToken {
        if (amount == 0) return;

        uint16 day = currentDayIndex();
        if (day-- == INITIALIZATION_DAY) {
            return;
        }

        // Update `from` balances and create a new record for the past period if needed
        if (
            from != address(0) &&
            (_balanceRecords[from].length == 0 || _balanceRecords[from][_balanceRecords[from].length - 1].day < day)
        ) {
            uint240 balance = toUint240(IERC20Upgradeable(TOKEN).balanceOf(from) + amount);
            _balanceRecords[from].push(Record({ day: day, value: balance }));
            emit BalanceRecordCreated(from, day, balance);
        }

        // Update `to` balances and create a new record for the past period if needed
        if (
            to != address(0) &&
            (_balanceRecords[to].length == 0 || _balanceRecords[to][_balanceRecords[to].length - 1].day < day)
        ) {
            uint240 balance = toUint240(IERC20Upgradeable(TOKEN).balanceOf(to) - amount);
            _balanceRecords[to].push(Record({ day: day, value: balance }));
            emit BalanceRecordCreated(to, day, balance);
        }
    }

    /**
     * @inheritdoc IERC20Hook
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external override onlyToken {}

    /**
     * @notice Returns the daily balance record at the specified index and the length of the balance record array
     * @param account The account to get the balance record for
     * @param index The index of the balance record
     */
    function getBalanceRecord(address account, uint256 index) external view returns (Record memory, uint256) {
        return (_balanceRecords[account][index], _balanceRecords[account].length);
    }

    /**
     * @notice Returns the index of the current day (including the day time shift)
     */
    function currentDayIndex() public view returns (uint16) {
        return toUint16((_blockTimestamp() - _timeShift()) / _dayDuration());
    }

    /**
     * @dev Overridable for testing purposes
     */
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @dev Overridable for testing purposes
     */
    function _dayDuration() internal pure virtual returns (uint256) {
        return DAY;
    }

    /**
     * @dev Overridable for testing purposes
     */
    function _timeShift() internal pure virtual returns (uint256) {
        return NEGATIVE_TIME_SHIFT;
    }

    /**
     * @dev Returns the downcasted uint240 from uint256, reverting on
     * overflow (when the input is greater than largest uint240).
     */
    function toUint240(uint256 value) private pure returns (uint240) {
        if (value > type(uint240).max) {
            revert SafeCastOverflow();
        }

        return uint240(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     */
    function toUint16(uint256 value) private pure returns (uint16) {
        if (value > type(uint16).max) {
            revert SafeCastOverflow();
        }

        return uint16(value);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[48] private __gap;
}
