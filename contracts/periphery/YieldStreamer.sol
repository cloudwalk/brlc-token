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
 * @dev The contract that supports yield streaming based on a minimum balance over a period
 */
contract YieldStreamer is
    OwnableUpgradeable,
    PausableExtUpgradeable,
    BlacklistableUpgradeable,
    IBalanceTracker,
    IYieldStreamer
{
    /// @notice The factor that is used together yield rate values
    /// @dev e.g. 0.1% rate should be represented as 0.001*RATE_FACTOR
    uint240 public constant RATE_FACTOR = 1000000;

    /// @notice The initial state of the next claim for an account
    struct ClaimState {
        uint16 day;    // The index of the day from which the yield will be calculated next time
        uint240 debit; // The amount of yield that is already considered claimed for this day
    }

    /// @notice The parameters of a look-back period
    struct LookBackPeriod {
        uint16 effectiveDay; // The index of the day this look-back period come into use
        uint16 length;       // The length of the look-back period in days
    }

    /// @notice The parameters of a yield rate
    struct YieldRate {
        uint16 effectiveDay; // The index of the day this yield rate come into use
        uint240 value;       // The value of the yield rate
    }

    /// @notice The address of the tax receiver
    address internal _taxReceiver;

    /// @notice The address of the token balance tracker
    address internal _balanceTracker;

    /// @notice The array of yield rates in chronological order
    YieldRate[] internal _yieldRates;

    /// @notice The array of look-back periods in chronological order
    LookBackPeriod[] internal _lookBackPeriods;

    /// @notice The mapping of account to its next claim initial state
    mapping(address => ClaimState) internal _claims;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when the tax receiver is changed
     *
     * @param newReceiver The address of the new tax receiver
     * @param oldReceiver The address of the old tax receiver
     */
    event TaxReceiverChanged(address newReceiver, address oldReceiver);

    /**
     * @notice Emitted when the balance tracker is changed
     *
     * @param newTracker The address of the new balance tracker
     * @param oldTracker The address of the old balance tracker
     */
    event BalanceTrackerChanged(address newTracker, address oldTracker);

    /**
     * @notice Emitted when a new look-back period is added to the chronological array
     *
     * @param effectiveDay The index of the day the look-back period come into use
     * @param length  The length of the new look-back period in days
     */
    event LookBackPeriodConfigured(uint256 effectiveDay, uint256 length);

    /**
     * @notice Emitted when a new yield rate is added to the chronological array
     *
     * @param effectiveDay The index of the day the yield rate come into use
     * @param value The value of the yield rate
     */
    event YieldRateConfigured(uint256 effectiveDay, uint256 value);

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
     * @notice Adds a new look-back period to the chronological array
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new day must be greater than the last day
     * - The new value must not be zero
     *
     * Emits an {LookBackPeriodConfigured} event
     *
     * @param effectiveDay The index of the day the look-back period come into use
     * @param length The length of the new look-back period in days
     */
    function configureLookBackPeriod(uint256 effectiveDay, uint256 length) external onlyOwner {
        if (_lookBackPeriods.length > 0 && _lookBackPeriods[_lookBackPeriods.length - 1].effectiveDay >= effectiveDay) {
            revert InvalidDay("The new day must be greater than the last look-back period day");
        }
        if (_lookBackPeriods.length > 0 && _lookBackPeriods[_lookBackPeriods.length - 1].length == length) {
            revert InvalidValue("The new length must be different than the last look-back period length");
        }
        if (length == 0) {
            revert InvalidValue("The look-back period length must not be zero");
        }

        if (_lookBackPeriods.length > 0) {
            // As temporary solution, prevent multiple configuration
            // of the look-back period as this will require a more complex logic
            revert("The look-back period is already configured");
        }

        _lookBackPeriods.push(LookBackPeriod({ effectiveDay: _toUint16(effectiveDay), length: _toUint16(length) }));

        emit LookBackPeriodConfigured(effectiveDay, length);
    }

    /**
     * @notice Adds a new yield rate to the chronological array
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new day must be greater than the last day
     *
     * Emits an {YieldRateConfigured} event
     *
     * @param effectiveDay The index of the day the yield rate come into use
     * @param value The value of the yield rate
     */
    function configureYieldRate(uint256 effectiveDay, uint256 value) external onlyOwner {
        if (_yieldRates.length > 0 && _yieldRates[_yieldRates.length - 1].effectiveDay >= effectiveDay) {
            revert InvalidDay("The new day must be greater than the last yield rate day");
        }
        if (_yieldRates.length > 0 && _yieldRates[_yieldRates.length - 1].value == value) {
            revert InvalidDay("The new value must be different than the last yield rate value");
        }

        _yieldRates.push(YieldRate({ effectiveDay: _toUint16(effectiveDay), value: _toUint240(value) }));

        emit YieldRateConfigured(effectiveDay, value);
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
    function claim(uint256 amount) external whenNotPaused notBlacklisted(_msgSender()) {
        _claim(_msgSender(), amount);
    }

    // -------------------- BalanceTracker Functions -----------------

    /**
     * @inheritdoc IBalanceTracker
     */
    function getDailyBalances(address account, uint256 fromDay, uint256 toDay) public view returns (uint256[] memory) {
        return IBalanceTracker(_balanceTracker).getDailyBalances(account, fromDay, toDay);
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
    function claimPreview(address account, uint256 amount) public view returns (ClaimResult memory) {
        return _claimPreview(account, amount);
    }

    /**
     * @notice Returns the last claim details for the specified account
     *
     * @param account The address of an account to get the claim details for
     */
    function getLastClaimDetails(address account) public view returns (ClaimState memory) {
        return _claims[account];
    }

    /**
     * @notice Calculates the daily yield of an account accrued for the specified period
     *
     * @param account The address of an account to calculate the yield for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     */
    function calculateYieldByDays(
        address account,
        uint256 fromDay,
        uint256 toDay
    ) public view returns (uint256[] memory) {
        /**
         * Fetch the yield rate
         */
        uint256 rateIndex = _yieldRates.length;
        while (_yieldRates[--rateIndex].effectiveDay <= fromDay) {}

        /**
         * Fetch the look-back period
         */
        uint256 periodLength = _lookBackPeriods[0].length;

        /**
         * Calculate the daily yield for the period
         */
        uint256[] memory dailyBalances = getDailyBalances(account, fromDay + 1 - periodLength, toDay);
        uint256[] memory minBalances = _subMinimums(dailyBalances, periodLength);
        uint256[] memory yieldByDays = new uint256[](minBalances.length);
        uint256 nextRateDay = fromDay;
        uint256 rateValue = 0;
        uint256 yield = 0;
        uint256 i = 0;

        do {
            if (fromDay + i == nextRateDay) {
                rateValue = _yieldRates[rateIndex].value;
                if (rateIndex != _yieldRates.length - 1) {
                    nextRateDay = _yieldRates[++rateIndex].effectiveDay;
                }
            }
            yield += ((minBalances[i] + yield) * rateValue) / RATE_FACTOR;
            yieldByDays[i] = yield;
        } while (++i < minBalances.length);

        return yieldByDays;
    }

    /**
     * @notice Returns the minimum daily balances of an account for the specified period
     *
     * @param account The address of an account to get the balances for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     */
    function getMinBalances(address account, uint256 fromDay, uint256 toDay) public view returns (uint256[] memory) {
        uint256 periodLength = _lookBackPeriods[0].effectiveDay;
        uint256[] memory dailyBalances = getDailyBalances(account, fromDay + 1 - periodLength, toDay);
        return _subMinimums(dailyBalances, periodLength);
    }

    /**
     * @notice Reads the look-back period chronological array
     *
     * @param index The index of the look-back period in the array
     * @return The details of the look-back period and the length of the array
     */
    function getLookBackPeriod(uint256 index) public view returns (LookBackPeriod memory, uint256) {
        return (_lookBackPeriods[index], _lookBackPeriods.length);
    }

    /**
     * @notice Reads the yield rate chronological array
     *
     * @param index The index of the yield rate in the array
     * @return The details of the yield rate and the length of the array
     */
    function getYieldRate(uint256 index) public view returns (YieldRate memory, uint256) {
        return (_yieldRates[index], _yieldRates.length);
    }

    /**
     * @notice Calculates the stream yield for the specified amount and time
     *
     * @param amount The amount to calculate the stream yield for
     * @param time The time to calculate the stream yield for
     */
    function calculateStream(uint256 amount, uint256 time) public pure returns (uint256) {
        return (amount * time) / 1 days;
    }

    /**
     * @notice Calculates the amount of yield tax
     *
     * @param amount The yield amount to calculate the tax for
     * @param passedDays The number of days passed since the yield was accrued
     */
    function calculateTax(uint256 amount, uint256 passedDays) public pure returns (uint256) {
        if (passedDays <= 180) {
            return (amount * 225000) / RATE_FACTOR;
        } else if (passedDays <= 360) {
            return (amount * 200000) / RATE_FACTOR;
        } else if (passedDays <= 720) {
            return (amount * 175000) / RATE_FACTOR;
        } else {
            return (amount * 150000) / RATE_FACTOR;
        }
    }

    /**
     * @notice Returns the balance tracker address
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
     * @notice Returns the preview result of claiming the specified amount of yield
     *
     * @param account The address of an account to preview the claim for
     * @param amount The amount of yield to be claimed
     */
    function _claimPreview(address account, uint256 amount) internal view returns (ClaimResult memory) {
        (uint256 day, uint256 time) = dayAndTime();
        ClaimState memory state = _claims[account];
        ClaimResult memory result;

        if (state.day != --day) {
            /**
             * The account has not made a claim today yet
             * Calculate the yield for the period since the last claim
             */

            if (state.day != 0) {
                /**
                 * Account has claimed before, so use the last claim day
                 */
                result.nextClaimDay = state.day;
            } else {
                /**
                 * Account has never claimed before, so use the first look-back period day
                 */
                result.nextClaimDay = _lookBackPeriods[0].effectiveDay;
            }

            /**
             * Calculate the yield by days since the last claim day until yesterday
             */
            uint256[] memory yieldByDays = calculateYieldByDays(account, result.nextClaimDay, day);
            uint256 lastIndex = yieldByDays.length - 1;

            /**
             * Calculate the amount of yield streamed for the current day
             */
            result.streamYield = calculateStream(yieldByDays[lastIndex], time);

            /**
             * Update the first day in the yield by days array
             */
            if (yieldByDays[0] > state.debit) {
                yieldByDays[0] -= state.debit;
            } else {
                yieldByDays[0] = 0;
            }

            /**
             * Calculate accrued yield and tax for the specified period
             * Exit the loop when the accrued yield exceeds the claim amount
             */
            uint256 i = 0;
            do {
                result.primaryYield += yieldByDays[i];
                result.tax += calculateTax(yieldByDays[i], lastIndex - i);
            } while (result.primaryYield < amount && ++i < lastIndex);

            if (i == 0) {
                result.nextClaimDebit += state.debit;
            }

            if (result.primaryYield >= amount) {
                /**
                 * If the yield exceeds the amount, take the surplus into account
                 */
                uint256 surplus = result.primaryYield - amount;

                result.nextClaimDay += i;
                result.nextClaimDebit += yieldByDays[i] - surplus;
                result.tax -= calculateTax(surplus, lastIndex - i);

                /**
                 * Complete the calculation of the accrued yield and tax for the period
                 */
                while (++i < lastIndex) {
                    result.primaryYield += yieldByDays[i];
                }
            } else {
                /**
                 * If the yield doesn't exceed the amount, calculate the yield and tax for today
                 */
                result.nextClaimDay = day;

                if (amount != type(uint256).max) {
                    result.nextClaimDebit = amount - result.primaryYield;
                    if (result.nextClaimDebit > result.streamYield) {
                        result.shortfall = result.nextClaimDebit - result.streamYield;
                        result.nextClaimDebit = result.streamYield;
                    }
                } else {
                    result.nextClaimDebit = result.streamYield;
                }

                result.tax += calculateTax(result.nextClaimDebit, 0);
            }
        } else {
            /**
             * The account has already made a claim today
             * Therefore, recalculate the yield and tax only for today
             */

            result.nextClaimDay = day;
            result.nextClaimDebit = state.debit;

            uint256[] memory yieldByDays = calculateYieldByDays(account, day, day);
            result.streamYield = calculateStream(yieldByDays[0], time);

            if (amount != type(uint256).max) {
                result.nextClaimDebit += amount;
                if (result.nextClaimDebit > result.streamYield) {
                    result.shortfall = result.nextClaimDebit - result.streamYield;
                    result.nextClaimDebit = result.streamYield;
                }
            } else {
                result.nextClaimDebit = result.streamYield;
            }

            result.tax = calculateTax(result.nextClaimDebit - state.debit, 0);
        }

        return result;
    }

    /**
     * @notice Claims the specified amount of yield for an account
     *
     * @param account The address of an account to claim the yield for
     * @param amount The amount of yield to claim
     */
    function _claim(address account, uint256 amount) internal returns (ClaimResult memory) {
        ClaimResult memory preview = _claimPreview(account, amount);

        if (preview.shortfall > 0) {
            revert InvalidClaimRequest("The claim amount is greater than the available yield");
        }

        _claims[account].day = _toUint16(preview.nextClaimDay);
        _claims[account].debit = _toUint240(preview.nextClaimDebit);

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
