// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IYieldStreamer } from "./../base/interfaces/periphery/IYieldStreamer.sol";
import { IBalanceTracker } from "./../base/interfaces/periphery/IBalanceTracker.sol";
import { PausableExtUpgradeable } from "./../base/common/PausableExtUpgradeable.sol";
import { BlacklistableUpgradeable } from "./../base/common/BlacklistableUpgradeable.sol";
import { RescuableUpgradeable } from "./../base/common/RescuableUpgradeable.sol";

/**
 * @title YieldStreamer contract
 * @author CloudWalk Inc.
 * @dev The contract that supports yield streaming based on a minimum balance over a period
 */
contract YieldStreamer is
    OwnableUpgradeable,
    PausableExtUpgradeable,
    BlacklistableUpgradeable,
    RescuableUpgradeable,
    IBalanceTracker,
    IYieldStreamer
{
    /// @notice The factor that is used together with yield rate values
    /// @dev e.g. 0.1% rate should be represented as 0.001*RATE_FACTOR
    uint240 public constant RATE_FACTOR = 1000000000000;

    /// @notice The fee rate that is used to calculate the fee amount
    uint240 public constant FEE_RATE = 225000000000;

    /// @notice The coefficient used to round the yield, fee and other related values
    /// @dev e.g. value `12345678` will be rounded upward to `12350000` and down to `12340000`
    uint256 public constant ROUNDING_COEF = 10000;

    /// @notice The minimum amount that is allowed to be claimed
    uint256 public constant MIN_CLAIM_AMOUNT = 1000000;

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

    /// @notice The address of the fee receiver
    address internal _feeReceiver;

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
     * @notice Emitted when the fee receiver is changed
     *
     * @param newReceiver The address of the new fee receiver
     * @param oldReceiver The address of the old fee receiver
     */
    event FeeReceiverChanged(address newReceiver, address oldReceiver);

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
     * @notice Emitted when an existing look-back period is updated
     *
     * @param index The The index of the updated look-back period in the chronological array
     * @param oldEffectiveDay The old index of the day the updated look-back period come into use
     * @param newEffectiveDay The new index of the day the updated look-back period come into use
     * @param newLength  The old length of the updated look-back period in days
     * @param oldLength  The old length of the updated look-back period in days
     */
    event LookBackPeriodUpdated(
        uint256 index,
        uint256 newEffectiveDay,
        uint256 oldEffectiveDay,
        uint256 newLength,
        uint256 oldLength
    );

    /**
     * @notice Emitted when a new yield rate is added to the chronological array
     *
     * @param effectiveDay The index of the day the yield rate come into use
     * @param value The value of the yield rate
     */
    event YieldRateConfigured(uint256 effectiveDay, uint256 value);

    /**
     * @notice Emitted when an yield rate is updated
     *
     * @param index The The index of the yield rate array in the chronological array
     * @param newEffectiveDay The new effective day of the updated yield rate come into use
     * @param oldEffectiveDay The old effective day of the updated yield rate
     * @param newValue The new yield rate value
     * @param oldValue The old yield rate value
     */
    event YieldRateUpdated(
        uint256 index,
        uint256 newEffectiveDay,
        uint256 oldEffectiveDay,
        uint256 newValue,
        uint256 oldValue
    );

    // -------------------- Errors -----------------------------------

    /**
     * @notice Thrown when the specified effective day of a look-back period is not greater than the last configured one
     */
    error LookBackPeriodInvalidEffectiveDay();

    /**
     * @notice Thrown when the specified length of a look-back period is already configured
     */
    error LookBackPeriodLengthAlreadyConfigured();

    /**
     * @notice Thrown when the specified length of a look-back period is zero
     */
    error LookBackPeriodLengthZero();

    /**
     * @notice Thrown when the specified effective day of a look-back period is outside the earliest possible period
     */
    error LookBackPeriodInvalidParametersCombination();

    /**
     * @notice Thrown when the limit of count for already configured look-back periods has reached
     */
    error LookBackPeriodCountLimit();

    /**
     * @notice Thrown when the specified look-back period index is out of range
     */
    error LookBackPeriodWrongIndex();

    /**
     * @notice Thrown when the specified effective day of a yield rate does not meet the requirements
     */
    error YieldRateInvalidEffectiveDay();

    /**
     * @notice Thrown when the specified value of a yield rate is already configured
     */
    error YieldRateValueAlreadyConfigured();

    /**
     * @notice Thrown when the index of a yield rate is out of range
     */
    error YieldRateWrongIndex();

    /**
     * @notice Thrown when the requested claim is rejected due to its amount is greater than the available yield
     * @param shortfall The shortfall value
     */
    error ClaimRejectionDueToShortfall(uint256 shortfall);

    /**
     * @notice Thrown when the same balance tracker contract is already configured
     */
    error BalanceTrackerAlreadyConfigured();

    /**
     * @notice Thrown when the same fee receiver is already configured
     */
    error FeeReceiverAlreadyConfigured();

    /**
     * @notice Thrown when the requested claim amount is below the allowed minimum
     */
    error ClaimAmountBelowMinimum();

    /**
     * @notice Thrown when the requested claim amount is non-rounded down according to the `ROUNDING_COEF` value
     */
    error ClaimAmountNonRounded();

    /**
     * @notice Thrown when the value does not fit in the type uint16
     */
    error SafeCastOverflowUint16();

    /**
     * @notice Thrown when the value does not fit in the type uint240
     */
    error SafeCastOverflowUint240();

    /**
     * @notice Thrown when the specified "to" day is prior the specified "from" day
     */
    error ToDayPriorFromDay();

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
     * @notice Sets the address of the fee receiver
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new fee receiver address must not be the same as the current one
     *
     * Emits an {FeeReceiverChanged} event
     *
     * @param newFeeReceiver The address of the new fee receiver
     */
    function setFeeReceiver(address newFeeReceiver) external onlyOwner {
        if (_feeReceiver == newFeeReceiver) {
            revert FeeReceiverAlreadyConfigured();
        }

        emit FeeReceiverChanged(newFeeReceiver, _feeReceiver);

        _feeReceiver = newFeeReceiver;
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
            revert BalanceTrackerAlreadyConfigured();
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
     * - The new day must be greater than the look-back period
     * - The new value must not be zero
     *
     * Emits an {LookBackPeriodConfigured} event
     *
     * @param effectiveDay The index of the day the look-back period come into use
     * @param length The length of the new look-back period in days
     */
    function configureLookBackPeriod(uint256 effectiveDay, uint256 length) external onlyOwner {
        if (_lookBackPeriods.length > 0 && _lookBackPeriods[_lookBackPeriods.length - 1].effectiveDay >= effectiveDay) {
            revert LookBackPeriodInvalidEffectiveDay();
        }
        if (_lookBackPeriods.length > 0 && _lookBackPeriods[_lookBackPeriods.length - 1].length == length) {
            revert LookBackPeriodLengthAlreadyConfigured();
        }
        if (length == 0) {
            revert LookBackPeriodLengthZero();
        }

        if (effectiveDay < length - 1) {
            revert LookBackPeriodInvalidParametersCombination();
        }

        if (_lookBackPeriods.length != 0) {
            // As temporary solution, prevent multiple configuration
            // of the look-back period as this will require a more complex logic
            revert LookBackPeriodCountLimit();
        }

        _lookBackPeriods.push(LookBackPeriod({ effectiveDay: _toUint16(effectiveDay), length: _toUint16(length) }));

        emit LookBackPeriodConfigured(effectiveDay, length);
    }

    /**
     * @notice Updates the look-back period at the specified index
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - The new day must be greater than the last day
     * - The new day must be greater than the look-back period
     * - The new value must not be zero
     *
     * Emits an {LookBackPeriodConfigured} event
     *
     * @param effectiveDay The index of the day the look-back period come into use
     * @param length The length of the new look-back period in days
     * @param index The index of the look-back period in the array
     */
    function updateLookBackPeriod(uint256 effectiveDay, uint256 length,  uint256 index) external onlyOwner {
        if (length == 0) {
            revert LookBackPeriodLengthZero();
        }
        if (effectiveDay < length - 1) {
            revert LookBackPeriodInvalidParametersCombination();
        }
        if (index >= _lookBackPeriods.length) {
            revert LookBackPeriodWrongIndex();
        }

        LookBackPeriod storage period = _lookBackPeriods[index];

        emit LookBackPeriodUpdated(
            index,
            effectiveDay,
            period.effectiveDay,
            length,
            period.length);

        period.effectiveDay = _toUint16(effectiveDay);
        period.length = _toUint16(length);
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
            revert YieldRateInvalidEffectiveDay();
        }
        if (_yieldRates.length > 0 && _yieldRates[_yieldRates.length - 1].value == value) {
            revert YieldRateValueAlreadyConfigured();
        }

        _yieldRates.push(YieldRate({ effectiveDay: _toUint16(effectiveDay), value: _toUint240(value) }));

        emit YieldRateConfigured(effectiveDay, value);
    }

    /**
     * @notice Updates the yield rate at the specified index
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     * - Yield rate must be configured
     * - The index must be in range of yield rates array
     * - The new effective day must be greater than one of the previous yield rate and less than the effective day on the next yield rate
     *
     * Emits an {YieldRateUpdated} event
     *
     * @param effectiveDay The index of the day the yield rate come into use
     * @param value The value of the yield rate
     * @param index The index of the yield rate in the array
     */
    function updateYieldRate(uint256 effectiveDay, uint256 value, uint256 index) external onlyOwner {
        if (index >= _yieldRates.length) {
            revert YieldRateWrongIndex();
        }

        uint256 lastIndex = _yieldRates.length - 1;

        if(lastIndex != 0) {
            int256 intEffectiveDay = int256(effectiveDay);
            int256 previousEffectiveDay = index != 0
                ? int256(uint256(_yieldRates[index - 1].effectiveDay))
                : type(int256).min;
            int256 nextEffectiveDay = index != lastIndex
                ? int256(uint256(_yieldRates[index + 1].effectiveDay))
                : type(int256).max;
            if (intEffectiveDay <= previousEffectiveDay || intEffectiveDay >= nextEffectiveDay) {
                revert YieldRateInvalidEffectiveDay();
            }
        }

        YieldRate storage yieldRate = _yieldRates[index];

        emit YieldRateUpdated(
            index,
            effectiveDay,
            yieldRate.effectiveDay,
            value,
            yieldRate.value);

        yieldRate.effectiveDay = _toUint16(effectiveDay);
        yieldRate.value = _toUint240(value);
    }

    // -------------------- User Functions ---------------------------

    /**
     * @inheritdoc IYieldStreamer
     *
     * @dev The contract must not be paused
     * @dev The caller of the function must not be blacklisted
     * @dev The requested claim amount must be no less than the `MIN_CLAIM_AMOUNT` value
     * @dev The requested claim amount must be rounded according to the `ROUNDING_COEF` value
     */
    function claim(uint256 amount) external whenNotPaused notBlacklisted(_msgSender()) {
        if (amount < MIN_CLAIM_AMOUNT) {
            revert ClaimAmountBelowMinimum();
        }
        if (amount != _roundDown(amount)) {
            revert ClaimAmountNonRounded();
        }
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
     *
     * @dev The requested claim amount must be no less than the `MIN_CLAIM_AMOUNT` value
     * @dev The requested claim amount must be rounded according to the `ROUNDING_COEF` value
     */
    function claimPreview(address account, uint256 amount) public view returns (ClaimResult memory) {
        if (amount < MIN_CLAIM_AMOUNT) {
            revert ClaimAmountBelowMinimum();
        }
        if (amount != _roundDown(amount)) {
            revert ClaimAmountNonRounded();
        }
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
     * @notice Calculates the daily yield of an account accrued for a specified period of days
     *
     * Requirements:
     *
     * - The `fromDay` value must not be greater than the `toDay` value
     * - The `fromDay` value must not be less than the initialization day of the used BalanceTracker contract
     *
     * @param account The address of an account to calculate the yield for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     * @param nextClaimDebit The amount of yield that is considered claimed for the first day of the period
     */
    function calculateYieldByDays(
        address account,
        uint256 fromDay,
        uint256 toDay,
        uint256 nextClaimDebit
    ) external view returns (uint256[] memory) {
        if (toDay < fromDay) {
            revert ToDayPriorFromDay();
        }
        uint256[] memory yieldByDays;
        (yieldByDays,) = _calculateYieldAndPossibleBalanceByDays(account, fromDay, toDay, nextClaimDebit);
        return yieldByDays;
    }

    /**
     * @notice Reads the look-back period chronological array
     *
     * @param index The index of the look-back period in the array
     * @return The details of the look-back period and the length of the array
     */
    function getLookBackPeriod(uint256 index) public view returns (LookBackPeriod memory, uint256) {
        uint256 len = _lookBackPeriods.length;
        if (len > index) {
            return (_lookBackPeriods[index], len);
        } else {
            LookBackPeriod memory emptyItem;
            return (emptyItem, len);
        }
    }

    /**
     * @notice Reads the yield rate chronological array
     *
     * @param index The index of the yield rate in the array
     * @return The details of the yield rate and the length of the array
     */
    function getYieldRate(uint256 index) public view returns (YieldRate memory, uint256) {
        uint256 len = _yieldRates.length;
        if (len > index) {
            return (_yieldRates[index], len);
        } else {
            YieldRate memory emptyItem;
            return (emptyItem, len);
        }
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
     * @notice Calculates the amount of yield fee
     *
     * @param amount The yield amount to calculate the fee for
     */
    function calculateFee(uint256 amount) public pure returns (uint256) {
        return (amount * FEE_RATE) / RATE_FACTOR;
    }

    /**
     * @notice Returns the balance tracker address
     */
    function balanceTracker() external view returns (address) {
        return _balanceTracker;
    }

    /**
     * @notice Returns the fee receiver address
     */
    function feeReceiver() external view returns (address) {
        return _feeReceiver;
    }

    /**
     * @notice Returns the daily balances with yield for a specified account and period of days
     *
     * The function returns the same values as if the account claims all available yield (if any exists) at the end of
     * each day within the requested period of days without token spending
     *
     * Requirements:
     *
     * - The `fromDay` value must not be greater than the `toDay` value
     * - The `fromDay` value must not be less than the initialization day of the used BalanceTracker contract
     *
     * @param account The address of the account to get the balances with yield for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     */
    function getDailyBalancesWithYield(
        address account,
        uint16 fromDay,
        uint16 toDay
    ) external view returns (uint256[] memory) {
        if (toDay < fromDay) {
            revert ToDayPriorFromDay();
        }

        ClaimState memory state = _claims[account];

        if (state.day == 0) {
            state.day = _lookBackPeriods[0].effectiveDay;
        }

        if (state.day > toDay) {
            return getDailyBalances(account, fromDay, toDay);
        } else {
            uint256[] memory possibleBalanceByDays;
            (, possibleBalanceByDays) = _calculateYieldAndPossibleBalanceByDays(account, state.day, toDay, state.debit);
            uint256 firstDayWithYield = toDay + 2 - possibleBalanceByDays.length;
            uint256[] memory dailyBalances;
            if (fromDay < firstDayWithYield) {
                dailyBalances = getDailyBalances(account, fromDay, firstDayWithYield - 1);
            }

            uint256 len = toDay + 1 - fromDay;
            uint256[] memory dailyBalancesWithYield = new uint256[](len);
            uint256 i = 0;
            for (; i + fromDay < firstDayWithYield; ++i) {
                dailyBalancesWithYield[i] = dailyBalances[i];
            }
            uint256 j = i + fromDay - firstDayWithYield;
            for (; i < len; ++i) {
                dailyBalancesWithYield[i] = possibleBalanceByDays[j++];
            }
            return dailyBalancesWithYield;
        }
    }

    // -------------------- Internal Functions -----------------------
    /**
     * @notice Calculates the daily yield and possible balance of an account for a specified period of days
     *
     * @param account The address of an account to calculate the yield and possible balance for
     * @param fromDay The index of the first day of the period
     * @param toDay The index of the last day of the period
     * @param nextClaimDebit The amount of yield that is considered claimed for the first day of the period
     */
    function _calculateYieldAndPossibleBalanceByDays(
        address account,
        uint256 fromDay,
        uint256 toDay,
        uint256 nextClaimDebit
    ) internal view returns (uint256[] memory yieldByDays, uint256[] memory possibleBalanceByDays) {
        /**
         * Fetch the yield rate
         */
        uint256 rateIndex = _yieldRates.length;
        while (_yieldRates[--rateIndex].effectiveDay > fromDay && rateIndex > 0) {}

        /**
         * Fetch the look-back period
         */
        uint256 periodLength = _lookBackPeriods[0].length;

        /**
         * Calculate the daily yield for the period
         */
        uint256 yieldRange = toDay - fromDay + 1;
        possibleBalanceByDays = getDailyBalances(account, fromDay + 1 - periodLength, toDay + 1);
        yieldByDays = new uint256[](yieldRange);
        uint256 rateValue = _yieldRates[rateIndex].value;
        uint256 nextRateDay;
        if (rateIndex != _yieldRates.length - 1) {
            nextRateDay = _yieldRates[++rateIndex].effectiveDay;
        } else {
            nextRateDay = toDay + 1;
        }

        // Define first day yield and initial sum yield
        uint256 sumYield = 0;
        uint256 dayYield = _getMinimumInRange(possibleBalanceByDays, 0, periodLength) * rateValue / RATE_FACTOR;
        if (dayYield > nextClaimDebit) {
            sumYield = dayYield - nextClaimDebit;
        }
        possibleBalanceByDays[periodLength] += sumYield;
        yieldByDays[0] = dayYield;


        // Define yield for other days
        for (uint256 i = 1; i < yieldRange; ++i) {
            if (fromDay + i == nextRateDay) {
                rateValue = _yieldRates[rateIndex].value;
                if (rateIndex != _yieldRates.length - 1) {
                    nextRateDay = _yieldRates[++rateIndex].effectiveDay;
                }
            }
            uint256 minBalance = _getMinimumInRange(possibleBalanceByDays, i, i + periodLength);
            dayYield = minBalance * rateValue / RATE_FACTOR;
            sumYield += dayYield;
            possibleBalanceByDays[i + periodLength] += sumYield;
            yieldByDays[i] = dayYield;
        }
    }

    /**
     * @notice Searches a minimum value in an array for the specified range of indexes
     *
     * @param array The array to search in
     * @param begIndex The index of the array from which the search begins, including that index
     * @param endIndex The index of the array at which the search ends, excluding that index
     */
    function _getMinimumInRange(
        uint256[] memory array,
        uint256 begIndex,
        uint256 endIndex
    ) internal pure returns (uint256) {
        uint256 min = array[begIndex];
        for (uint256 i = begIndex + 1; i < endIndex; ++i) {
            uint256 value = array[i];
            if (value < min) {
                min = value;
            }
        }
        return min;
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
        result.prevClaimDebit = state.debit;

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
            result.firstYieldDay = result.nextClaimDay;

            /**
             * Calculate the yield by days since the last claim day until yesterday
             */
            uint256[] memory yieldByDays;
            (yieldByDays, )= _calculateYieldAndPossibleBalanceByDays(account, result.nextClaimDay, day, state.debit);
            uint256 lastIndex = yieldByDays.length - 1;

            /**
             * Calculate the amount of yield streamed for the current day
             */
            result.lastDayYield = yieldByDays[lastIndex];
            result.streamYield = calculateStream(result.lastDayYield, time);

            /**
             * Update the first day in the yield by days array
             */
            if (state.debit > yieldByDays[0]) {
                yieldByDays[0] = 0;
            } else {
                yieldByDays[0] -= state.debit;
            }

            /**
             * Calculate accrued yield for the specified period
             * Exit the loop when the accrued yield exceeds the claim amount
             */
            uint256 i = 0;
            do {
                result.primaryYield += yieldByDays[i];
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
                result.yield = amount;

                /**
                 * Complete the calculation of the accrued yield for the period
                 */
                while (++i < lastIndex) {
                    result.primaryYield += yieldByDays[i];
                }
            } else {
                /**
                 * If the yield doesn't exceed the amount, calculate the yield for today
                 */
                result.nextClaimDay = day;

                if (amount != type(uint256).max) {
                    result.nextClaimDebit = amount - result.primaryYield;
                    if (result.nextClaimDebit > result.streamYield) {
                        result.shortfall = result.nextClaimDebit - result.streamYield;
                        result.nextClaimDebit = result.streamYield;
                        // result.yield is zero at this point
                    } else {
                        result.yield = amount;
                    }
                } else {
                    result.nextClaimDebit = result.streamYield;
                    result.yield = _roundDown(result.primaryYield + result.streamYield);
                }
            }
        } else {
            /**
             * The account has already made a claim today
             * Therefore, recalculate the yield only for today
             */

            result.nextClaimDay = day;
            result.firstYieldDay = day;
            result.nextClaimDebit = state.debit;

            uint256[] memory yieldByDays;
            (yieldByDays, ) = _calculateYieldAndPossibleBalanceByDays(account, day, day, state.debit);
            result.lastDayYield = yieldByDays[0];
            result.streamYield = calculateStream(result.lastDayYield, time);

            if (state.debit > result.streamYield) {
                result.streamYield = 0;
            } else {
                result.streamYield -= state.debit;
            }

            if (amount != type(uint256).max) {
                if (amount > result.streamYield) {
                    result.shortfall = amount - result.streamYield;
                    result.nextClaimDebit += result.streamYield;
                    // result.yield is zero at this point
                } else {
                    result.nextClaimDebit += amount;
                    result.yield = amount;
                }
            } else {
                result.nextClaimDebit += result.streamYield;
                result.yield = _roundDown(result.streamYield);
            }
        }

        result.fee = _roundUpward(calculateFee(result.yield));

        return result;
    }

    /**
     * @notice Claims the specified amount of yield for an account
     *
     * @param account The address of an account to claim the yield for
     * @param amount The amount of yield to claim
     */
    function _claim(address account, uint256 amount) internal {
        ClaimResult memory preview = _claimPreview(account, amount);

        if (preview.shortfall > 0) {
            revert ClaimRejectionDueToShortfall(preview.shortfall);
        }

        _claims[account].day = _toUint16(preview.nextClaimDay);
        _claims[account].debit = _toUint240(preview.nextClaimDebit);

        IERC20Upgradeable(token()).transfer(_feeReceiver, preview.fee);
        IERC20Upgradeable(token()).transfer(account, preview.yield - preview.fee);

        emit Claim(account, preview.yield, preview.fee);
    }

    /**
     * @dev Returns the downcasted uint240 from uint256, reverting on
     * overflow (when the input is greater than largest uint240)
     */
    function _toUint240(uint256 value) internal pure returns (uint240) {
        if (value > type(uint240).max) {
            revert SafeCastOverflowUint240();
        }

        return uint240(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16)
     */
    function _toUint16(uint256 value) internal pure returns (uint16) {
        if (value > type(uint16).max) {
            revert SafeCastOverflowUint16();
        }

        return uint16(value);
    }

    function _roundDown(uint256 amount) internal pure returns (uint256) {
        return (amount / ROUNDING_COEF) * ROUNDING_COEF;
    }

    function _roundUpward(uint256 amount) internal pure returns (uint256) {
        uint256 roundedAmount = _roundDown(amount);
        if (roundedAmount < amount) {
            roundedAmount += ROUNDING_COEF;
        }
        return roundedAmount;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[45] private __gap;
}
