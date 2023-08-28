// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IYieldStreamer } from "./../base/interfaces/periphery/IYieldStreamer.sol";
import { IBalanceTracker } from "./../base/interfaces/periphery/IBalanceTracker.sol";
import { PausableExtUpgradeable } from "./../base/common/PausableExtUpgradeable.sol";
import { BlacklistableUpgradeable } from "./../base/common/BlacklistableUpgradeable.sol";

/**
 * @title YieldStreamer contract
 * @author CloudWalk Inc.
 * @dev The contract that supports yield streaming base on a minimum balance over a period range
 */
contract YieldStreamer is
    OwnableUpgradeable,
    PausableExtUpgradeable,
    BlacklistableUpgradeable,
    IBalanceTracker,
    IYieldStreamer
{
    /// @notice The address of the token balance tracker contract
    uint240 public constant RATE_BASE = 1000000;

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

    /// @notice The array of rate records
    Record[] internal _rates;

    /// @notice The array of boundary records
    Record[] internal _boundaries;

    /// @notice The address of the tax receiver
    address internal _taxReceiver;

    /// @notice The address of the token balance tracker
    address internal _balanceTracker;

    /// @notice The mapping of account to its claim record
    mapping(address => Record) internal _claims;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when the balance tracker contract is changed
     *
     * @param newTracker The address of the new balance tracker
     * @param oldTracker The address of the old balance tracker
     */
    event BalanceTrackerChanged(address newTracker, address oldTracker);

    /**
     * @notice Emitted when the tax receiver address is changed
     *
     * @param newReceiver The address of the new tax receiver
     * @param oldReceiver The address of the old tax receiver
     */
    event TaxReceiverChanged(address newReceiver, address oldReceiver);

    /**
     * @notice Emitted when the actual boundary is changed
     *
     * @param day The day of the actual boundary
     * @param value The value of the actual boundary
     */
    event BoundaryChanged(uint256 day, uint256 value);

    /**
     * @notice Emitted when the actual rate is changed
     *
     * @param day The day of the actual rate
     * @param value The value of the actual rate
     */
    event RateChanged(uint256 day, uint256 value);

    // -------------------- Errors -----------------------------------

    /**
     * @notice Thrown when the specified day is invalid
     *
     * @param message The error message
     */
    error InvalidDay(string message);

    /**
     * @notice Thrown when the specified value is invalid
     *
     * @param message The error message
     */
    error InvalidValue(string message);

    /**
     * @notice Thrown when the invalid claim request is made
     *
     * @param message The error message
     */
    error InvalidClaimRequest(string message);

    /**
     * @notice Thrown when the same configuration is already applied
     *
     * @param message The error message
     */
    error AlreadyConfigured(string message);

    /**
     * @notice Thrown when the value does not fit in the specified type
     *
     * @param message The error message
     */
    error SafeCastOverflow(string message);

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
        __YieldStreamer_init();
    }

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See {YieldStreamer-initialize}
     */
    function __YieldStreamer_init() internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __YieldStreamer_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {YieldStreamer-initialize}
     */
    function __YieldStreamer_init_unchained() internal onlyInitializing {}

    // -------------------- Admin Functions --------------------------

    /**
     * @notice Sets the address of the token balance tracker
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new balance tracker address must not be the same as the current one
     *
     * Emits an {BalanceTrackerChanged} event
     *
     * @param newBalanceTracker The address of the new balance tracker
     */
    function setBalanceTracker(address newBalanceTracker) external onlyOwner {
        if (_balanceTracker == newBalanceTracker) {
            revert AlreadyConfigured("The same balance tracker is already configured");
        }

        emit BalanceTrackerChanged(newBalanceTracker, _balanceTracker);

        _balanceTracker = newBalanceTracker;
    }

    /**
     * @notice Sets the address of the tax receiver
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new tax receiver address must not be the same as the current one
     *
     * Emits an {TaxReceiverChanged} event
     *
     * @param newTaxReceiver The address of the new tax receiver
     */
    function setTaxReceiver(address newTaxReceiver) external onlyOwner {
        if (_taxReceiver == newTaxReceiver) {
            revert AlreadyConfigured("The same tax receiver is already configured");
        }

        emit TaxReceiverChanged(newTaxReceiver, _taxReceiver);

        _taxReceiver = newTaxReceiver;
    }

    /**
     * @notice Sets the actual boundary
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new day must be greater than the last day
     * - The new value must not be zero
     *
     * Emits an {BoundaryChanged} event
     *
     * @param day The day of the actual boundary
     * @param value The value of the actual boundary
     */
    function setBoundary(uint256 day, uint256 value) external onlyOwner {
        if (_boundaries.length > 0 && _boundaries[_boundaries.length - 1].day >= day) {
            revert InvalidDay("The new day must be greater than the last boundary day");
        }
        if (_boundaries.length > 0 && _boundaries[_boundaries.length - 1].value == value) {
            revert InvalidValue("The new value must be different than the last boundary value");
        }
        if (value == 0) {
            revert InvalidValue("The boundary value cannot be zero");
        }

        if (_boundaries.length > 0) {
            // As temporary solution, prevent multiple configuration
            // of the boundary as this will require a more complex logic
            revert("The boundary is already configured");
        }

        _boundaries.push(Record({ day: _toUint16(day), value: _toUint240(value) }));

        emit BoundaryChanged(day, value);
    }

    /**
     * @notice Sets the actual rate
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new day must be greater than the last day
     *
     * Emits an {RateChanged} event
     *
     * @param day The day of the actual rate
     * @param value The value of the actual rate
     */
    function setRate(uint256 day, uint256 value) external onlyOwner {
        if (_rates.length > 0 && _rates[_rates.length - 1].day >= day) {
            revert InvalidDay("The new day must be greater than the last rate day");
        }
        if (_rates.length > 0 && _rates[_rates.length - 1].value == value) {
            revert InvalidDay("The new value must be different than the last rate value");
        }

        _rates.push(Record({ day: _toUint16(day), value: _toUint240(value) }));

        emit RateChanged(day, value);
    }

    // -------------------- User Functions ---------------------------

    /**
     * @inheritdoc IYieldStreamer
     */
    function claimAll() external whenNotPaused notBlacklisted(_msgSender()) {
        _claim(_msgSender(), type(uint256).max);
    }

    /**
     * @inheritdoc IYieldStreamer
     */
    function claimAmount(uint256 amount) external whenNotPaused notBlacklisted(_msgSender()) {
        _claim(_msgSender(), amount);
    }

    // -------------------- BalanceTracker Functions -----------------

    /**
     * @inheritdoc IBalanceTracker
     */
    function getDailyBalances(address account, uint256 from, uint256 to) public view returns (uint256[] memory) {
        return IBalanceTracker(_balanceTracker).getDailyBalances(account, from, to);
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function dayAndTime() public view returns (uint256, uint256) {
        return IBalanceTracker(_balanceTracker).dayAndTime();
    }

    /**
     * @inheritdoc IBalanceTracker
     */
    function token() public view returns (address) {
        return IBalanceTracker(_balanceTracker).token();
    }

    // -------------------- View Functions ---------------------------

    /**
     * @inheritdoc IYieldStreamer
     */
    function claimAllPreview(address account) external view returns (ClaimResult memory) {
        return _claimPreview(account, type(uint256).max);
    }

    /**
     * @inheritdoc IYieldStreamer
     */
    function claimAmountPreview(address account, uint256 amount) public view returns (ClaimResult memory) {
        return _claimPreview(account, amount);
    }

    /**
     * @notice Returns the last claim details for the specified account
     *
     * @param account The address of an account to get the claim details for
     */
    function getLastClaimDetails(address account) public view returns (Record memory) {
        return _claims[account];
    }

    /**
     * @notice Returns the daily earnings of an account for the specified period range
     *
     * @param account The account to get the earnings for
     * @param from The start day of the period range
     * @param to The end day of the period range
     */
    function getDailyEarnings(address account, uint256 from, uint256 to) public view returns (uint256[] memory) {
        /**
         * Fetch the current rate
         */
        uint256 rateIndex = _rates.length;
        while (_rates[--rateIndex].day > to) {}
        Record memory rate = _rates[rateIndex];

        /**
         * Fetch the current boundary size
         */
        uint256 boundarySize = _boundaries[0].value;

        /**
         * Calculate the daily earnings for the period range
         */
        uint256[] memory dailyBalances = getDailyBalances(account, from + 1 - boundarySize, to);
        uint256[] memory minBalances = _subMinimums(dailyBalances, boundarySize);
        uint256[] memory earnings = new uint256[](minBalances.length);
        uint256 i = minBalances.length;

        do {
            --i;
            if (from + i < rate.day) {
                rate = _rates[--rateIndex];
            }
            /**
             * TBD: Use compound interest formula
             */
            earnings[i] = (minBalances[i] * rate.value) / RATE_BASE;
        } while (i > 0);

        return earnings;
    }

    /**
     * @notice Returns the minimum daily balances of an account for the specified period range
     *
     * @param account The account to get the minimum balances for
     * @param from The start day of the period range
     * @param to The end day of the period range
     */
    function getMinBalances(address account, uint256 from, uint256 to) public view returns (uint256[] memory) {
        uint256 boundarySize = _boundaries[0].value;
        uint256[] memory dailyBalances = getDailyBalances(account, from + 1 - boundarySize, to);
        return _subMinimums(dailyBalances, boundarySize);
    }

    /**
     * @notice Reads the boundary record array
     *
     * @param index The index of the record to read
     * @return The record at the specified index and the length of array
     */
    function readBoundaryRecord(uint256 index) public view returns (Record memory, uint256) {
        return (_boundaries[index], _boundaries.length);
    }

    /**
     * @notice Reads the rate record array
     *
     * @param index The index of the record to read
     * @return The record at the specified index and the length of array
     */
    function readRateRecord(uint256 index) public view returns (Record memory, uint256) {
        return (_rates[index], _rates.length);
    }

    /**
     * @notice Calculates the stream income for the specified amount and time
     *
     * @param amount The amount to calculate the stream income for
     * @param time The time to calculate the stream income for
     */
    function calculateStream(uint256 amount, uint256 time) public pure returns (uint256) {
        return (amount * time) / 1 days;
    }

    /**
     * @notice Calculates the tax for the specified value and day
     *
     * @param amount The amount to calculate the tax for
     * @param day The day to calculate the tax for
     */
    function calculateTax(uint256 amount, uint256 day) public pure returns (uint256) {
        if (day <= 180) {
            return (amount * 225000) / RATE_BASE;
        } else if (day <= 360) {
            return (amount * 200000) / RATE_BASE;
        } else if (day <= 720) {
            return (amount * 175000) / RATE_BASE;
        } else {
            return (amount * 150000) / RATE_BASE;
        }
    }

    /**
     * @notice Returns the balance tracker contract address
     */
    function balanceTracker() external view returns (address) {
        return _balanceTracker;
    }

    /**
     * @notice Returns the tax receiver address
     */
    function taxReceiver() external view returns (address) {
        return _taxReceiver;
    }

    // -------------------- Internal Functions -----------------------

    /**
     * @notice Returns an array of minimum values of each subarray of the specified size
     *
     * @dev The implementation is based on sliding window algorithm
     *
     * @param numbers The input array of numbers
     * @param size The size of the subarray
     */
    function _subMinimums(uint256[] memory numbers, uint256 size) internal pure returns (uint256[] memory) {
        uint256 length = numbers.length;
        uint256[] memory result = new uint256[](length + 1 - size);
        uint256[] memory dq = new uint256[](length);
        uint256 index = length;
        uint256 head = 0;
        uint256 tail = 0;

        do {
            --index;

            if (head < tail && dq[head] - index >= size) {
                ++head;
            }

            while (head < tail && numbers[index] < numbers[dq[tail - 1]]) {
                --tail;
            }

            dq[tail++] = index;

            if (length - index >= size) {
                result[index] = numbers[dq[head]];
            }
        } while (index > 0);

        return result;
    }

    /**
     * @notice Returns the claim preview result for the specified account and amount
     *
     * @param account The address of an account to preview the claim
     * @param amount The amount of income to claim
     */
    function _claimPreview(address account, uint256 amount) internal view returns (ClaimResult memory) {
        (uint256 day, uint256 time) = dayAndTime();
        Record memory claim = _claims[account];
        ClaimResult memory result;

        if (claim.day != --day) {
            /**
             * The account has not made a withdraw today
             * Therefore, calculate the income for the period range
             */

            if (claim.day != 0) {
                /**
                 * Account has claimed before, get the last claim day
                 */
                result.day = claim.day;
            } else {
                /**
                 * Account has never claimed before, get the first boundary day
                 */
                result.day = _boundaries[0].day;
            }

            /**
             * Calculate the daily earnings since the last claim day until yesterday
             */
            uint256[] memory earnings = getDailyEarnings(account, result.day, day);
            uint256 length = earnings.length - 1;

            /**
             * Calculate the stream earnings for today
             */
            result.streamIncome = calculateStream(earnings[length], time);

            /**
             * Subtract the last claim amount from the earnings
             */
            earnings[0] -= claim.value;

            /**
             * Iterate over the daily earnings and calculate accrued income and total tax
             * Exit the loop when the accrued income exceeds the claimed amount
             */
            uint256 i = 0;
            do {
                result.heldIncome += earnings[i];
                result.tax += calculateTax(earnings[i], length - i);
            } while (result.heldIncome < amount && ++i < length);

            if (i == 0) {
                result.debt += claim.value;
            }

            if (result.heldIncome >= amount) {
                /**
                 * If the income is greater than the amount take a step back to
                 * calculate the surplus and update the result values
                 */
                uint256 surplus = result.heldIncome - amount;

                result.day += i;
                result.debt += earnings[i] - surplus;
                result.tax -= calculateTax(surplus, length - i);

                /**
                 * Continue iterating over the daily earnings
                 * to calculate the total income
                 */
                while (++i < length) {
                    result.heldIncome += earnings[i];
                }
            } else {
                /**
                 * If the income is not greater than the amount, calculate the income and tax for today
                 */
                result.day = day;

                if (amount != type(uint256).max) {
                    result.debt = amount - result.heldIncome;
                    if (result.debt > result.streamIncome) {
                        result.shortfall = result.debt - result.streamIncome;
                        result.debt = result.streamIncome;
                    }
                } else {
                    result.debt = result.streamIncome;
                }

                result.tax += calculateTax(result.debt, 0);
            }
        } else {
            /**
             * The account has already made a withdraw today
             * Therefore, calculate the income only for today
             */

            result.day = day;
            result.debt = claim.value;

            uint256[] memory earnings = getDailyEarnings(account, result.day, day);
            result.streamIncome = calculateStream(earnings[0], time);

            if (amount != type(uint256).max) {
                result.debt += amount;
                if (result.debt > result.streamIncome) {
                    result.shortfall = result.debt - result.streamIncome;
                    result.debt = result.streamIncome;
                }
            } else {
                result.debt = result.streamIncome;
            }

            result.tax = calculateTax(result.debt - claim.value, 0);
        }

        return result;
    }

    /**
     * @notice Claims the specified amount of income for the specified account
     *
     * @param account The address of an account to claim the income for
     * @param amount The amount of income to claim
     */
    function _claim(address account, uint256 amount) internal returns (ClaimResult memory) {
        ClaimResult memory preview = _claimPreview(account, amount);

        if (preview.shortfall > 0) {
            revert InvalidClaimRequest("The claim amount is greater than the available income");
        }

        _claims[account].day = _toUint16(preview.day);
        _claims[account].value = _toUint240(preview.debt);

        IERC20Upgradeable(token()).transfer(_taxReceiver, preview.tax);
        IERC20Upgradeable(token()).transfer(account, amount - preview.tax);

        emit Claim(account, amount, preview.tax);

        return preview;
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
    uint256[45] private __gap;
}
