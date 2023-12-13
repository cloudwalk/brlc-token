import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";
import { TransactionResponse } from "@ethersproject/abstract-provider";

const ZERO_ADDRESS = ethers.constants.AddressZero;
const BIG_NUMBER_ZERO = ethers.constants.Zero;
const BIG_NUMBER_MAX_UINT256 = ethers.constants.MaxUint256;
const YIELD_STREAMER_INIT_TOKEN_BALANCE: BigNumber = BigNumber.from(1000_000_000_000);
const USER_CURRENT_TOKEN_BALANCE: BigNumber = BigNumber.from(1000_000_000_000);
const LOOK_BACK_PERIOD_LENGTH: number = 3;
const INITIAL_YIELD_RATE = 10000000000; // 1%
const BALANCE_TRACKER_INIT_DAY = 100;
const YIELD_STREAMER_INIT_DAY = BALANCE_TRACKER_INIT_DAY + LOOK_BACK_PERIOD_LENGTH - 1;
const FEE_RATE: BigNumber = BigNumber.from(225000000000);
const RATE_FACTOR: BigNumber = BigNumber.from(1000000000000);
const MIN_CLAIM_AMOUNT: BigNumber = BigNumber.from(1000000);
const ROUNDING_COEF: BigNumber = BigNumber.from(10000);
const BALANCE_TRACKER_ADDRESS_STUB = "0x0000000000000000000000000000000000000001";

interface TestContext {
  tokenMock: Contract;
  balanceTrackerMock: Contract;
  yieldStreamer: Contract;
}

interface BalanceRecord {
  day: number,
  value: BigNumber,
}

interface ClaimResult {
  nextClaimDay: BigNumber;
  nextClaimDebit: BigNumber;
  firstYieldDay: BigNumber;
  prevClaimDebit: BigNumber;
  primaryYield: BigNumber;
  streamYield: BigNumber;
  lastDayYield: BigNumber;
  shortfall: BigNumber;
  fee: BigNumber;
  yield: BigNumber;
  claimDebitIsGreaterThanFirstDayYield: boolean;
}

interface LookBackPeriodRecord {
  effectiveDay: number,
  length: BigNumber,
}

interface YieldRateRecord {
  effectiveDay: number,
  value: BigNumber,
}

interface ClaimRequest {
  amount: BigNumber;
  firstYieldDay: number,
  claimDay: number,
  claimTime: number
  claimDebit: BigNumber;
  lookBackPeriodLength: number,
  yieldRateRecords: YieldRateRecord[],
  balanceRecords: BalanceRecord[],
}

interface YieldByDaysRequest {
  lookBackPeriodLength: number,
  yieldRateRecords: YieldRateRecord[],
  balanceRecords: BalanceRecord[],
  dayFrom: number,
  dayTo: number,
  claimDebit: BigNumber,
}

interface BalanceWithYieldByDaysRequest extends YieldByDaysRequest {
  firstYieldDay: number,
}

interface ClaimState {
  day: number;
  debit: BigNumber;
}

const balanceRecordsCase1: BalanceRecord[] = [
  { day: BALANCE_TRACKER_INIT_DAY, value: BigNumber.from(0) },
  { day: BALANCE_TRACKER_INIT_DAY + 1, value: BigNumber.from(8000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 2, value: BigNumber.from(7000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 3, value: BigNumber.from(6000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 4, value: BigNumber.from(5000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 5, value: BigNumber.from(1000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 6, value: BigNumber.from(3000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 7, value: BigNumber.from(2000_000_000_000) },
  { day: BALANCE_TRACKER_INIT_DAY + 8, value: BigNumber.from(1000_000_000_000) },
];

const yieldRateRecordCase1: YieldRateRecord = {
  effectiveDay: YIELD_STREAMER_INIT_DAY,
  value: BigNumber.from(INITIAL_YIELD_RATE),
};

const yieldRateRecordCase2: YieldRateRecord = {
  effectiveDay: YIELD_STREAMER_INIT_DAY + 4,
  value: BigNumber.from(INITIAL_YIELD_RATE * 2),
};

const yieldRateRecordCase3: YieldRateRecord = {
  effectiveDay: YIELD_STREAMER_INIT_DAY + 6,
  value: BigNumber.from(INITIAL_YIELD_RATE * 3),
};

function defineExpectedDailyBalances(balanceRecords: BalanceRecord[], dayFrom: number, dayTo: number): BigNumber[] {
  if (dayFrom > dayTo) {
    throw new Error(
      `Cannot define daily balances because 'dayFrom' is greater than 'dayTo'. ` +
      `The 'dayFrom' value: ${dayFrom}. The 'dayTo' value: ${dayTo}`
    );
  }
  const dailyBalances: BigNumber[] = [];
  if (balanceRecords.length === 0) {
    for (let day = dayFrom; day <= dayTo; ++day) {
      dailyBalances.push(USER_CURRENT_TOKEN_BALANCE);
    }
  } else {
    let recordIndex = 0;
    for (let day = dayFrom; day <= dayTo; ++day) {
      for (; recordIndex < balanceRecords.length; ++recordIndex) {
        if (balanceRecords[recordIndex].day >= day) {
          break;
        }
      }
      if (recordIndex >= balanceRecords.length || balanceRecords[recordIndex].day < day) {
        dailyBalances.push(USER_CURRENT_TOKEN_BALANCE);
      } else {
        dailyBalances.push(balanceRecords[recordIndex].value);
      }
    }
  }
  return dailyBalances;
}

function min(bigNumber1: BigNumber, bigNumber2: BigNumber): BigNumber {
  if (bigNumber1.lt(bigNumber2)) {
    return bigNumber1;
  } else {
    return bigNumber2;
  }
}

function roundDown(value: BigNumber): BigNumber {
  return value.div(ROUNDING_COEF).mul(ROUNDING_COEF);
}

function roundUpward(value: BigNumber): BigNumber {
  let roundedValue = value.div(ROUNDING_COEF).mul(ROUNDING_COEF);
  if (!roundedValue.eq(value)) {
    roundedValue = roundedValue.add(ROUNDING_COEF);
  }
  return roundedValue;
}

function defineYieldRate(yieldRateRecords: YieldRateRecord[], day: number): BigNumber {
  const len = yieldRateRecords.length;
  if (len === 0) {
    return BIG_NUMBER_ZERO;
  }
  if (yieldRateRecords[0].effectiveDay > day) {
    return BIG_NUMBER_ZERO;
  }

  for (let i = 0; i < len; ++i) {
    const yieldRateRecord: YieldRateRecord = yieldRateRecords[i];
    if (yieldRateRecord.effectiveDay > day) {
      return yieldRateRecords[i - 1].value;
    }
  }

  return yieldRateRecords[yieldRateRecords.length - 1].value;
}

function defineExpectedYieldByDays(yieldByDaysRequest: YieldByDaysRequest): BigNumber[] {
  const { lookBackPeriodLength, yieldRateRecords, balanceRecords, dayFrom, dayTo, claimDebit } = yieldByDaysRequest;
  if (dayFrom > dayTo) {
    throw new Error("Day 'from' is grater than day 'to' when defining the yield by days");
  }
  const len = dayTo + 1 - dayFrom;
  const yieldByDays: BigNumber[] = [];
  const balancesDayFrom = dayFrom - lookBackPeriodLength + 1;
  const balancesDayTo = dayTo + 1;
  const balances: BigNumber[] = defineExpectedDailyBalances(balanceRecords, balancesDayFrom, balancesDayTo);

  let sumYield: BigNumber = BIG_NUMBER_ZERO;
  for (let i = 0; i < len; ++i) {
    const yieldRate: BigNumber = defineYieldRate(yieldRateRecords, dayFrom + i);
    const minBalance: BigNumber = balances.slice(i, lookBackPeriodLength + i).reduce(min);
    const yieldValue: BigNumber = minBalance.mul(yieldRate).div(RATE_FACTOR);
    if (i == 0) {
      if (yieldValue.gt(claimDebit)) {
        sumYield = yieldValue.sub(claimDebit);
      }
    } else {
      sumYield = sumYield.add(yieldValue);
    }
    balances[lookBackPeriodLength + i] = balances[lookBackPeriodLength + i].add(sumYield);
    yieldByDays.push(yieldValue);
  }

  return yieldByDays;
}

function defineExpectedBalanceWithYieldByDays(request: BalanceWithYieldByDaysRequest): BigNumber[] {
  const { balanceRecords, dayFrom, dayTo, firstYieldDay } = request;
  const balancesWithYield: BigNumber[] = defineExpectedDailyBalances(balanceRecords, dayFrom, dayTo);
  if (firstYieldDay <= dayTo) {
    const yieldByDaysRequest: YieldByDaysRequest = { ...(request as YieldByDaysRequest) };
    yieldByDaysRequest.dayFrom = request.firstYieldDay;
    const yields: BigNumber[] = defineExpectedYieldByDays(yieldByDaysRequest);
    if (yields[0].gt(request.claimDebit)) {
      yields[0] = yields[0].sub(request.claimDebit);
    } else {
      yields[0] = BIG_NUMBER_ZERO;
    }

    let sumYield = BIG_NUMBER_ZERO;
    for (let i = 0; i < balancesWithYield.length; ++i) {
      const yieldIndex = i + dayFrom - firstYieldDay - 1;
      if (yieldIndex >= 0) {
        sumYield = sumYield.add(yields[yieldIndex]);
        balancesWithYield[i] = balancesWithYield[i].add(sumYield);
      }
    }
  }

  return balancesWithYield;
}

function calculateFee(amount: BigNumber): BigNumber {
  return roundUpward(amount.mul(FEE_RATE).div(RATE_FACTOR));
}

function defineExpectedClaimResult(claimRequest: ClaimRequest): ClaimResult {
  const dayFrom: number = claimRequest.firstYieldDay;
  const dayTo: number = claimRequest.claimDay - 1;
  const yieldByDays: BigNumber[] = defineExpectedYieldByDays({
    lookBackPeriodLength: claimRequest.lookBackPeriodLength,
    yieldRateRecords: claimRequest.yieldRateRecords,
    balanceRecords: claimRequest.balanceRecords,
    dayFrom,
    dayTo,
    claimDebit: claimRequest.claimDebit
  });

  const lastIndex = yieldByDays.length - 1;
  const lastYield = yieldByDays[lastIndex];
  const partialLastYield: BigNumber = lastYield.mul(claimRequest.claimTime).div(86400);
  let indexWhenPrimaryYieldReachedAmount = lastIndex;
  let valueWhenPrimaryYieldReachedAmount: BigNumber = BIG_NUMBER_ZERO;
  let primaryYieldReachedAmount = false;
  let claimDebitIsGreaterThanFirstDayYield = false;

  if (dayFrom !== dayTo) {
    if (yieldByDays[0].gte(claimRequest.claimDebit)) {
      yieldByDays[0] = yieldByDays[0].sub(claimRequest.claimDebit);
    } else {
      yieldByDays[0] = BIG_NUMBER_ZERO;
      claimDebitIsGreaterThanFirstDayYield = true;
    }
  }

  let primaryYield = BIG_NUMBER_ZERO;
  for (let i = 0; i < lastIndex; ++i) {
    const yieldValue = yieldByDays[i];
    primaryYield = primaryYield.add(yieldValue);
    if (!primaryYieldReachedAmount) {
      if (primaryYield.gte(claimRequest.amount)) {
        indexWhenPrimaryYieldReachedAmount = i;
        valueWhenPrimaryYieldReachedAmount = primaryYield;
        primaryYieldReachedAmount = true;
      }
    }
  }

  let nextClaimDay: number;
  let nextClaimDebit: BigNumber;
  let streamYield: BigNumber;
  if (dayFrom === dayTo) {
    if (partialLastYield.gte(claimRequest.claimDebit)) {
      streamYield = partialLastYield.sub(claimRequest.claimDebit);
    } else {
      streamYield = BIG_NUMBER_ZERO;
      claimDebitIsGreaterThanFirstDayYield = true;
    }
    nextClaimDay = dayTo;
    if (claimRequest.amount.gt(streamYield)) {
      nextClaimDebit = claimRequest.claimDebit.add(streamYield);
    } else {
      nextClaimDebit = claimRequest.claimDebit.add(claimRequest.amount);
    }
  } else {
    streamYield = partialLastYield;
    if (primaryYieldReachedAmount) {
      nextClaimDay = dayFrom + indexWhenPrimaryYieldReachedAmount;
      const yieldSurplus: BigNumber = valueWhenPrimaryYieldReachedAmount.sub(claimRequest.amount);
      nextClaimDebit = yieldByDays[indexWhenPrimaryYieldReachedAmount].sub(yieldSurplus);
      if (indexWhenPrimaryYieldReachedAmount === 0) {
        nextClaimDebit = nextClaimDebit.add(claimRequest.claimDebit);
      }
    } else {
      nextClaimDay = dayTo;
      const amountSurplus: BigNumber = claimRequest.amount.sub(primaryYield);
      if (partialLastYield.gt(amountSurplus)) {
        nextClaimDebit = amountSurplus;
      } else {
        nextClaimDebit = partialLastYield;
      }
    }
  }

  let totalYield = primaryYield.add(streamYield);
  let shortfall: BigNumber = BIG_NUMBER_ZERO;
  if (claimRequest.amount.lt(BIG_NUMBER_MAX_UINT256)) {
    if (claimRequest.amount.gt(totalYield)) {
      shortfall = claimRequest.amount.sub(totalYield);
      totalYield = BIG_NUMBER_ZERO;
    } else {
      totalYield = claimRequest.amount;
    }
  } else {
    totalYield = roundDown(totalYield);
  }
  const fee: BigNumber = calculateFee(totalYield);

  return {
    nextClaimDay: BigNumber.from(nextClaimDay),
    nextClaimDebit: nextClaimDebit,
    firstYieldDay: BigNumber.from(dayFrom),
    prevClaimDebit: claimRequest.claimDebit,
    streamYield,
    primaryYield,
    lastDayYield: lastYield,
    shortfall,
    fee,
    yield: totalYield,
    claimDebitIsGreaterThanFirstDayYield
  };
}

function defineExpectedClaimAllResult(claimRequest: ClaimRequest): ClaimResult {
  const previousAmount = claimRequest.amount;
  claimRequest.amount = BIG_NUMBER_MAX_UINT256;
  const claimResult = defineExpectedClaimResult(claimRequest);
  claimRequest.amount = previousAmount;
  return claimResult;
}

function compareClaimPreviews(actualClaimPreviewResult: any, expectedClaimPreviewResult: ClaimResult) {
  expect(actualClaimPreviewResult.nextClaimDay.toString()).to.equal(
    expectedClaimPreviewResult.nextClaimDay.toString(),
    "The 'nextClaimDay' field is wrong"
  );

  expect(actualClaimPreviewResult.nextClaimDebit.toString()).to.equal(
    expectedClaimPreviewResult.nextClaimDebit.toString(),
    "The 'nextClaimDebit' field is wrong"
  );

  expect(actualClaimPreviewResult.primaryYield.toString()).to.equal(
    expectedClaimPreviewResult.primaryYield.toString(),
    "The 'nextClaimDebit' field is wrong"
  );

  expect(actualClaimPreviewResult.streamYield.toString()).to.equal(
    expectedClaimPreviewResult.streamYield.toString(),
    "The 'streamYield' field is wrong"
  );

  expect(actualClaimPreviewResult.shortfall.toString()).to.equal(
    expectedClaimPreviewResult.shortfall.toString(),
    "The 'shortfall' field is wrong"
  );

  expect(actualClaimPreviewResult.fee.toString()).to.equal(
    expectedClaimPreviewResult.fee.toString(),
    "The 'fee' field is wrong"
  );

  expect(actualClaimPreviewResult.yield.toString()).to.equal(
    expectedClaimPreviewResult.yield.toString(),
    "The 'yield' field is wrong"
  );
}

async function checkLookBackPeriods(
  yieldStreamer: Contract,
  expectedLookBackPeriodRecords: LookBackPeriodRecord[]
) {
  const expectedRecordArrayLength = expectedLookBackPeriodRecords.length;
  if (expectedRecordArrayLength == 0) {
    const actualRecordState = await yieldStreamer.getLookBackPeriod(0);
    const actualRecord = actualRecordState[0];
    const actualRecordArrayLength: number = actualRecordState[1].toNumber();
    expect(actualRecordArrayLength).to.equal(
      expectedRecordArrayLength,
      `Wrong look-back period array length. The array should be empty`
    );
    expect(actualRecord.effectiveDay).to.equal(
      0,
      `Wrong field '_lookBackPeriods[0].effectiveDay' for empty look-back period array`
    );
    expect(actualRecord[1]).to.equal( // Index is used here because 'length' return the internal property
      0,
      `Wrong field '_lookBackPeriods[0].length' for empty look-back period array`
    );
  } else {
    for (let i = 0; i < expectedRecordArrayLength; ++i) {
      const expectedRecord: LookBackPeriodRecord = expectedLookBackPeriodRecords[i];
      const actualRecordState = await yieldStreamer.getLookBackPeriod(i);
      const actualRecord = actualRecordState[0];
      const actualRecordArrayLength: number = actualRecordState[1].toNumber();
      expect(actualRecordArrayLength).to.equal(
        expectedRecordArrayLength,
        `Wrong look-back period array length`
      );
      expect(actualRecord.effectiveDay).to.equal(
        expectedRecord.effectiveDay,
        `Wrong field '_lookBackPeriods[${i}].effectiveDay'`
      );
      expect(actualRecord[1]).to.equal( // Index is used here because 'length' return the internal property
        expectedRecord.length,
        `Wrong field '_lookBackPeriods[${i}].length'`
      );
    }
  }
}

async function checkYieldRates(
  yieldStreamer: Contract,
  yieldRateRecords: YieldRateRecord[]
) {
  const expectedRecordArrayLength = yieldRateRecords.length;
  if (expectedRecordArrayLength == 0) {
    const actualRecordState = await yieldStreamer.getYieldRate(0);
    const actualRecord = actualRecordState[0];
    const actualRecordArrayLength: number = actualRecordState[1].toNumber();
    expect(actualRecordArrayLength).to.equal(
      expectedRecordArrayLength,
      `Wrong yield rate array length. The array should be empty`
    );
    expect(actualRecord.effectiveDay).to.equal(
      0,
      `Wrong field '_yieldRates[0].effectiveDay' for empty yield rate array`
    );
    expect(actualRecord.value).to.equal(
      0,
      `Wrong field '_yieldRates[0].value' for empty yield rate array`
    );
  } else {
    for (let i = 0; i < expectedRecordArrayLength; ++i) {
      const expectedRecord: YieldRateRecord = yieldRateRecords[i];
      const actualRecordState = await yieldStreamer.getYieldRate(i);
      const actualRecord = actualRecordState[0];
      const actualRecordArrayLength: number = actualRecordState[1].toNumber();
      expect(actualRecordArrayLength).to.equal(
        expectedRecordArrayLength,
        `Wrong yield rate array length`
      );
      expect(actualRecord.effectiveDay).to.equal(
        expectedRecord.effectiveDay,
        `Wrong field '_yieldRates[${i}].effectiveDay'`
      );
      expect(actualRecord.value).to.equal(
        expectedRecord.value,
        `Wrong field '_yieldRates[${i}].value'`
      );
    }
  }
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

function expectedYieldRateRecords(): YieldRateRecord[] {
  const expectedYieldRateRecord1: YieldRateRecord = {
    effectiveDay: YIELD_STREAMER_INIT_DAY,
    value: BigNumber.from(INITIAL_YIELD_RATE)
  };
  const expectedYieldRateRecord2: YieldRateRecord = {
    effectiveDay: YIELD_STREAMER_INIT_DAY + 3,
    value: BigNumber.from(INITIAL_YIELD_RATE * 2)
  };
  const expectedYieldRateRecord3: YieldRateRecord = {
    effectiveDay: YIELD_STREAMER_INIT_DAY + 6,
    value: BigNumber.from(INITIAL_YIELD_RATE * 3)
  };

  return [expectedYieldRateRecord1, expectedYieldRateRecord2, expectedYieldRateRecord3];
}

describe("Contract 'YieldStreamer'", async () => {

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  const REVERT_ERROR_BLACKLISTED_ACCOUNT = "BlacklistedAccount";
  const REVERT_ERROR_BALANCE_TRACKER_ALREADY_CONFIGURED = "BalanceTrackerAlreadyConfigured";
  const REVERT_ERROR_CLAIM_AMOUNT_BELOW_MINIMUM = "ClaimAmountBelowMinimum";
  const REVERT_ERROR_CLAIM_AMOUNT_NON_ROUNDED = "ClaimAmountNonRounded";
  const REVERT_ERROR_CLAIM_REJECTION_DUE_TO_SHORTFALL = "ClaimRejectionDueToShortfall";
  const REVERT_ERROR_FEE_RECEIVER_ALREADY_CONFIGURED = "FeeReceiverAlreadyConfigured";
  const REVERT_ERROR_LOOK_BACK_PERIOD_COUNT_LIMIT = "LookBackPeriodCountLimit";
  const REVERT_ERROR_LOOK_BACK_PERIOD_WRONG_INDEX = "LookBackPeriodWrongIndex";
  const REVERT_ERROR_LOOK_BACK_PERIOD_INVALID_EFFECTIVE_DAY = "LookBackPeriodInvalidEffectiveDay";
  const REVERT_ERROR_LOOK_BACK_PERIOD_INVALID_PARAMETERS_COMBINATION = "LookBackPeriodInvalidParametersCombination";
  const REVERT_ERROR_LOOK_BACK_PERIOD_LENGTH_ALREADY_CONFIGURED = "LookBackPeriodLengthAlreadyConfigured";
  const REVERT_ERROR_LOOK_BACK_PERIOD_LENGTH_ZERO = "LookBackPeriodLengthZero";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16 = "SafeCastOverflowUint16";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240 = "SafeCastOverflowUint240";
  const REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY = "ToDayPriorFromDay";
  const REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY = "YieldRateInvalidEffectiveDay";
  const REVERT_ERROR_YIELD_RATE_VALUE_ALREADY_CONFIGURED = "YieldRateValueAlreadyConfigured";
  const REVERT_ERROR_YIELD_RATE_WRONG_INDEX = "YieldRateWrongIndex";

  const EVENT_BALANCE_TRACKER_CHANGED = "BalanceTrackerChanged";
  const EVENT_CLAIM = "Claim";
  const EVENT_FEE_RECEIVER_CHANGED = "FeeReceiverChanged";
  const EVENT_LOOK_BACK_PERIOD_CONFIGURED = "LookBackPeriodConfigured";
  const EVENT_LOOK_BACK_PERIOD_UPDATED = "LookBackPeriodUpdated";
  const EVENT_YIELD_RATE_CONFIGURED = "YieldRateConfigured";
  const EVENT_YIELD_RATE_UPDATED = "YieldRateUpdated";

  let tokenMockFactory: ContractFactory;
  let balanceTrackerMockFactory: ContractFactory;
  let yieldStreamerFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let feeReceiver: SignerWithAddress;

  before(async () => {
    [deployer, user, feeReceiver] = await ethers.getSigners();
    tokenMockFactory = await ethers.getContractFactory("ERC20TestMock");
    balanceTrackerMockFactory = await ethers.getContractFactory("BalanceTrackerMock");
    yieldStreamerFactory = await ethers.getContractFactory("YieldStreamer");
  });

  async function deployContracts(): Promise<TestContext> {
    const tokenMock: Contract = await upgrades.deployProxy(tokenMockFactory, ["Test Token Mock", "TTM"]);
    await tokenMock.deployed();

    const balanceTrackerMock: Contract = await balanceTrackerMockFactory.deploy(tokenMock.address);
    await balanceTrackerMock.deployed();

    const yieldStreamer: Contract = await upgrades.deployProxy(yieldStreamerFactory);
    await yieldStreamer.deployed();
    await proveTx(yieldStreamer.enableBlacklist(true));

    return {
      tokenMock,
      balanceTrackerMock,
      yieldStreamer
    };
  }

  async function deployAndConfigureContracts(): Promise<TestContext> {
    const { tokenMock, balanceTrackerMock, yieldStreamer } = await deployContracts();

    await proveTx(yieldStreamer.setFeeReceiver(feeReceiver.address));
    await proveTx(yieldStreamer.setBalanceTracker(balanceTrackerMock.address));
    await proveTx(yieldStreamer.configureYieldRate(YIELD_STREAMER_INIT_DAY, INITIAL_YIELD_RATE));
    await proveTx(yieldStreamer.configureLookBackPeriod(YIELD_STREAMER_INIT_DAY, LOOK_BACK_PERIOD_LENGTH));
    await proveTx(balanceTrackerMock.setInitDay(BALANCE_TRACKER_INIT_DAY));
    await proveTx(balanceTrackerMock.setCurrentBalance(user.address, USER_CURRENT_TOKEN_BALANCE));
    await proveTx(tokenMock.mintForTest(yieldStreamer.address, YIELD_STREAMER_INIT_TOKEN_BALANCE));

    return {
      tokenMock,
      balanceTrackerMock,
      yieldStreamer
    };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const { yieldStreamer } = context;
      expect(await yieldStreamer.owner()).to.equal(deployer.address);
      expect(await yieldStreamer.balanceTracker()).to.equal(ZERO_ADDRESS);
      expect(await yieldStreamer.feeReceiver()).to.equal(ZERO_ADDRESS);
      expect(await yieldStreamer.RATE_FACTOR()).to.equal(RATE_FACTOR);
      expect(await yieldStreamer.FEE_RATE()).to.equal(FEE_RATE);
      expect(await yieldStreamer.MIN_CLAIM_AMOUNT()).to.equal(MIN_CLAIM_AMOUNT);
      expect(await yieldStreamer.ROUNDING_COEF()).to.equal(ROUNDING_COEF);
      await checkLookBackPeriods(yieldStreamer, []);
      await checkYieldRates(yieldStreamer, []);
    });

    it("Is reverted if called for the second time", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      await expect(context.yieldStreamer.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const yieldStreamerImplementation: Contract = await yieldStreamerFactory.deploy();
      await yieldStreamerImplementation.deployed();
      await expect(yieldStreamerImplementation.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });
  });

  describe("Function 'setFeeReceiver()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.setFeeReceiver(feeReceiver.address)
      ).to.emit(
        context.yieldStreamer,
        EVENT_FEE_RECEIVER_CHANGED
      ).withArgs(
        feeReceiver.address,
        ZERO_ADDRESS
      );

      expect(await context.yieldStreamer.feeReceiver()).to.equal(feeReceiver.address);

      await expect(
        context.yieldStreamer.setFeeReceiver(ZERO_ADDRESS)
      ).to.emit(
        context.yieldStreamer,
        EVENT_FEE_RECEIVER_CHANGED
      ).withArgs(
        ZERO_ADDRESS,
        feeReceiver.address
      );

      expect(await context.yieldStreamer.feeReceiver()).to.equal(ZERO_ADDRESS);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.connect(user).setFeeReceiver(feeReceiver.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if the same fee receiver is already configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.setFeeReceiver(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_FEE_RECEIVER_ALREADY_CONFIGURED
      );

      await proveTx(context.yieldStreamer.setFeeReceiver(feeReceiver.address));

      await expect(
        context.yieldStreamer.setFeeReceiver(feeReceiver.address)
      ).to.be.revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_FEE_RECEIVER_ALREADY_CONFIGURED
      );
    });
  });

  describe("Function 'setBalanceTracker()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.setBalanceTracker(BALANCE_TRACKER_ADDRESS_STUB)
      ).to.emit(
        context.yieldStreamer,
        EVENT_BALANCE_TRACKER_CHANGED
      ).withArgs(
        BALANCE_TRACKER_ADDRESS_STUB,
        ZERO_ADDRESS
      );

      expect(await context.yieldStreamer.balanceTracker()).to.equal(BALANCE_TRACKER_ADDRESS_STUB);

      await expect(
        context.yieldStreamer.setBalanceTracker(ZERO_ADDRESS)
      ).to.emit(
        context.yieldStreamer,
        EVENT_BALANCE_TRACKER_CHANGED
      ).withArgs(
        ZERO_ADDRESS,
        BALANCE_TRACKER_ADDRESS_STUB
      );

      expect(await context.yieldStreamer.balanceTracker()).to.equal(ZERO_ADDRESS);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.connect(user).setBalanceTracker(BALANCE_TRACKER_ADDRESS_STUB)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if the same balance tracker is already configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(
        context.yieldStreamer.setBalanceTracker(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_BALANCE_TRACKER_ALREADY_CONFIGURED
      );

      await proveTx(context.yieldStreamer.setBalanceTracker(BALANCE_TRACKER_ADDRESS_STUB));

      await expect(
        context.yieldStreamer.setBalanceTracker(BALANCE_TRACKER_ADDRESS_STUB)
      ).to.be.revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_BALANCE_TRACKER_ALREADY_CONFIGURED
      );
    });
  });

  describe("Function 'configureLookBackPeriod()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const expectedLookBackPeriodRecord: LookBackPeriodRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY,
        length: BigNumber.from(LOOK_BACK_PERIOD_LENGTH),
      };

      await expect(context.yieldStreamer.configureLookBackPeriod(
        expectedLookBackPeriodRecord.effectiveDay,
        expectedLookBackPeriodRecord.length
      )).to.emit(
        context.yieldStreamer,
        EVENT_LOOK_BACK_PERIOD_CONFIGURED
      ).withArgs(
        expectedLookBackPeriodRecord.effectiveDay,
        expectedLookBackPeriodRecord.length
      );

      await checkLookBackPeriods(context.yieldStreamer, [expectedLookBackPeriodRecord]);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await expect(context.yieldStreamer.connect(user).configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      )).revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if the effective day is invalid", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_INVALID_EFFECTIVE_DAY
      );
    });

    it("Is reverted if the same length is already configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay + 1,
        LOOK_BACK_PERIOD_LENGTH
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_LENGTH_ALREADY_CONFIGURED
      );
    });

    it("Is reverted if the new length is zero", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await expect(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        BIG_NUMBER_ZERO
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_LENGTH_ZERO
      );
    });

    it("Is reverted if the parameters combination is wrong", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = LOOK_BACK_PERIOD_LENGTH - 2;

      await expect(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_INVALID_PARAMETERS_COMBINATION
      );
    });

    it("Is reverted if a look-back period is already configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.configureLookBackPeriod(
        effectiveDay + 1,
        LOOK_BACK_PERIOD_LENGTH + 1
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_COUNT_LIMIT
      );
    });
  });

  describe("Function 'updateLookBackPeriod()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const expectedLookBackPeriodRecord: LookBackPeriodRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY,
        length: BigNumber.from(LOOK_BACK_PERIOD_LENGTH),
      };

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        expectedLookBackPeriodRecord.effectiveDay,
        expectedLookBackPeriodRecord.length
      ));

      await checkLookBackPeriods(context.yieldStreamer, [expectedLookBackPeriodRecord]);

      expectedLookBackPeriodRecord.effectiveDay = YIELD_STREAMER_INIT_DAY + 1;
      expectedLookBackPeriodRecord.length = BigNumber.from(LOOK_BACK_PERIOD_LENGTH + 1);

      await expect(context.yieldStreamer.updateLookBackPeriod(
        expectedLookBackPeriodRecord.effectiveDay,
        expectedLookBackPeriodRecord.length,
        0
      )).to.emit(
        context.yieldStreamer,
        EVENT_LOOK_BACK_PERIOD_UPDATED
      ).withArgs(
        0,
        YIELD_STREAMER_INIT_DAY + 1,
        YIELD_STREAMER_INIT_DAY,
        LOOK_BACK_PERIOD_LENGTH + 1,
        LOOK_BACK_PERIOD_LENGTH
      );

      await checkLookBackPeriods(context.yieldStreamer, [expectedLookBackPeriodRecord]);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        YIELD_STREAMER_INIT_DAY,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.connect(user).updateLookBackPeriod(
        YIELD_STREAMER_INIT_DAY + 1,
        LOOK_BACK_PERIOD_LENGTH + 1,
        0
      )).revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if look backs are not configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(context.yieldStreamer.updateLookBackPeriod(
          YIELD_STREAMER_INIT_DAY,
          LOOK_BACK_PERIOD_LENGTH,
          4
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_LOOK_BACK_PERIOD_WRONG_INDEX
      );
    });

    it("Is reverted if the new length is zero", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        YIELD_STREAMER_INIT_DAY,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.updateLookBackPeriod(
        YIELD_STREAMER_INIT_DAY + 1,
        BIG_NUMBER_ZERO,
        0
      )).revertedWithCustomError(
         context.yieldStreamer,
         REVERT_ERROR_LOOK_BACK_PERIOD_LENGTH_ZERO
      );
    });

    it("Is reverted if the parameters combination is wrong", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        YIELD_STREAMER_INIT_DAY,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.updateLookBackPeriod(
        LOOK_BACK_PERIOD_LENGTH - 2,
        LOOK_BACK_PERIOD_LENGTH,
        0
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_INVALID_PARAMETERS_COMBINATION
      );
    });

    it("Is reverted if the look-back period index is wrong", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await proveTx(context.yieldStreamer.configureLookBackPeriod(
        YIELD_STREAMER_INIT_DAY,
        LOOK_BACK_PERIOD_LENGTH
      ));

      await expect(context.yieldStreamer.updateLookBackPeriod(
        YIELD_STREAMER_INIT_DAY + 1,
        LOOK_BACK_PERIOD_LENGTH + 1,
        1
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_LOOK_BACK_PERIOD_WRONG_INDEX
      );
    });
  });

  describe("Function 'configureYieldRate()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const [
          expectedYieldRateRecord1,
          expectedYieldRateRecord2
      ] = expectedYieldRateRecords();

      await expect(context.yieldStreamer.configureYieldRate(
        expectedYieldRateRecord1.effectiveDay,
        expectedYieldRateRecord1.value
      )).to.emit(
        context.yieldStreamer,
        EVENT_YIELD_RATE_CONFIGURED
      ).withArgs(
        expectedYieldRateRecord1.effectiveDay,
        expectedYieldRateRecord1.value
      );

      await expect(context.yieldStreamer.configureYieldRate(
        expectedYieldRateRecord2.effectiveDay,
        expectedYieldRateRecord2.value
      )).to.emit(
        context.yieldStreamer,
        EVENT_YIELD_RATE_CONFIGURED
      ).withArgs(
        expectedYieldRateRecord2.effectiveDay,
        expectedYieldRateRecord2.value
      );

      await checkYieldRates(context.yieldStreamer, [expectedYieldRateRecord1, expectedYieldRateRecord2]);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await expect(context.yieldStreamer.connect(user).configureYieldRate(
        effectiveDay,
        INITIAL_YIELD_RATE
      )).revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if the effective day is invalid", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureYieldRate(
        effectiveDay,
        INITIAL_YIELD_RATE
      ));

      await expect(context.yieldStreamer.configureYieldRate(
        effectiveDay,
        INITIAL_YIELD_RATE
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY
      );
    });

    it("Is reverted if the same value is already configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureYieldRate(
        effectiveDay,
        INITIAL_YIELD_RATE
      ));

      await expect(context.yieldStreamer.configureYieldRate(
        effectiveDay + 1,
        INITIAL_YIELD_RATE
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_YIELD_RATE_VALUE_ALREADY_CONFIGURED
      );
    });

    // This test is to cover the internal function `_toUint16()`
    it("Is reverted if the effective day index is greater than 16-bit unsigned integer", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = 65536;

      await expect(context.yieldStreamer.configureYieldRate(
        effectiveDay,
        INITIAL_YIELD_RATE
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16
      );
    });

    // This test is to cover the internal function `_toUint240()`
    it("Is reverted if the new value is greater than 240-bit unsigned integer", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;
      const yieldRateValue: BigNumber =
        BigNumber.from("0x1000000000000000000000000000000000000000000000000000000000000");

      await expect(context.yieldStreamer.configureYieldRate(
        effectiveDay,
        yieldRateValue
      )).revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240
      );
    });
  });

  describe("Function 'updateYieldRate()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const [
          expectedYieldRateRecord1,
          expectedYieldRateRecord2,
          expectedYieldRateRecord3
      ] = expectedYieldRateRecords();

      await proveTx(context.yieldStreamer.configureYieldRate(
          expectedYieldRateRecord1.effectiveDay,
          expectedYieldRateRecord1.value
      ));

      await proveTx(context.yieldStreamer.configureYieldRate(
          expectedYieldRateRecord2.effectiveDay,
          expectedYieldRateRecord2.value
      ));

      await proveTx(context.yieldStreamer.configureYieldRate(
          expectedYieldRateRecord3.effectiveDay,
          expectedYieldRateRecord3.value
      ));

      const expectedYieldRateRecordUpdated1: YieldRateRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY + 2,
        value: BigNumber.from(INITIAL_YIELD_RATE * 4)
      };

      await expect(context.yieldStreamer.updateYieldRate(
          expectedYieldRateRecordUpdated1.effectiveDay,
          expectedYieldRateRecordUpdated1.value,
          0
      )).to.emit(
          context.yieldStreamer,
          EVENT_YIELD_RATE_UPDATED
      ).withArgs(
          0,
          expectedYieldRateRecordUpdated1.effectiveDay,
          expectedYieldRateRecord1.effectiveDay,
          expectedYieldRateRecordUpdated1.value,
          expectedYieldRateRecord1.value
      );

      await checkYieldRates(context.yieldStreamer, [
          expectedYieldRateRecordUpdated1,
          expectedYieldRateRecord2,
          expectedYieldRateRecord3
      ]);

      const expectedYieldRateRecordUpdated2: YieldRateRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY + 4,
        value: BigNumber.from(INITIAL_YIELD_RATE * 4)
      };

      await expect(context.yieldStreamer.updateYieldRate(
          expectedYieldRateRecordUpdated2.effectiveDay,
          expectedYieldRateRecordUpdated2.value,
          1
      )).to.emit(
          context.yieldStreamer,
          EVENT_YIELD_RATE_UPDATED
      ).withArgs(
          1,
          expectedYieldRateRecordUpdated2.effectiveDay,
          expectedYieldRateRecord2.effectiveDay,
          expectedYieldRateRecordUpdated2.value,
          expectedYieldRateRecord2.value
      );

      await checkYieldRates(context.yieldStreamer, [
          expectedYieldRateRecordUpdated1,
          expectedYieldRateRecordUpdated2,
          expectedYieldRateRecord3
      ]);

      const expectedYieldRateRecordUpdated3: YieldRateRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY + 8,
        value: BigNumber.from(INITIAL_YIELD_RATE * 4)
      };

      await expect(context.yieldStreamer.updateYieldRate(
          expectedYieldRateRecordUpdated3.effectiveDay,
          expectedYieldRateRecordUpdated3.value,
          2
      )).to.emit(
          context.yieldStreamer,
          EVENT_YIELD_RATE_UPDATED
      ).withArgs(
          2,
          expectedYieldRateRecordUpdated3.effectiveDay,
          expectedYieldRateRecord3.effectiveDay,
          expectedYieldRateRecordUpdated3.value,
          expectedYieldRateRecord3.value
      );

      await checkYieldRates(context.yieldStreamer, [
          expectedYieldRateRecordUpdated1,
          expectedYieldRateRecordUpdated2,
          expectedYieldRateRecordUpdated3
      ]);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await expect(context.yieldStreamer.connect(user).updateYieldRate(
          effectiveDay,
          INITIAL_YIELD_RATE,
          1
      )).revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if yield rates are not configured", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await expect(context.yieldStreamer.updateYieldRate(
          YIELD_STREAMER_INIT_DAY,
          INITIAL_YIELD_RATE,
          4
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_WRONG_INDEX
      );
    });

    it("Is reverted if the index is out of yield rate array", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;

      await proveTx(context.yieldStreamer.configureYieldRate(
          effectiveDay,
          INITIAL_YIELD_RATE
      ));

      await expect(context.yieldStreamer.updateYieldRate(
          effectiveDay,
          INITIAL_YIELD_RATE,
          4
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_WRONG_INDEX
      );
    });

    it("Is reverted if the effective day is invalid", async () => {
      const context: TestContext = await setUpFixture(deployContracts);

      await proveTx(context.yieldStreamer.configureYieldRate(
          YIELD_STREAMER_INIT_DAY + 2,
          INITIAL_YIELD_RATE
      ));

      await proveTx(context.yieldStreamer.configureYieldRate(
          YIELD_STREAMER_INIT_DAY + 4,
          INITIAL_YIELD_RATE * 2
      ));

      await proveTx(context.yieldStreamer.configureYieldRate(
          YIELD_STREAMER_INIT_DAY + 6,
          INITIAL_YIELD_RATE * 3
      ));

      await expect(context.yieldStreamer.updateYieldRate(
          YIELD_STREAMER_INIT_DAY + 10,
          INITIAL_YIELD_RATE,
          0
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY
      );

      await expect(context.yieldStreamer.updateYieldRate(
          YIELD_STREAMER_INIT_DAY + 1,
          INITIAL_YIELD_RATE,
          1
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY
      );

      await expect(context.yieldStreamer.updateYieldRate(
          YIELD_STREAMER_INIT_DAY + 10,
          INITIAL_YIELD_RATE,
          1
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY
      );

      await expect(context.yieldStreamer.updateYieldRate(
          YIELD_STREAMER_INIT_DAY + 1,
          INITIAL_YIELD_RATE,
          2
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_YIELD_RATE_INVALID_EFFECTIVE_DAY
      );
    });

    // This test is to cover the internal function `_toUint16()`
    it("Is reverted if the effective day index is greater than 16-bit unsigned integer", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = 65536;

      await proveTx(context.yieldStreamer.configureYieldRate(
          YIELD_STREAMER_INIT_DAY,
          INITIAL_YIELD_RATE
      ));

      await expect(context.yieldStreamer.updateYieldRate(
          effectiveDay,
          INITIAL_YIELD_RATE,
          0
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16
      );
    });

    // This test is to cover the internal function `_toUint240()`
    it("Is reverted if the new value is greater than 240-bit unsigned integer", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const effectiveDay = YIELD_STREAMER_INIT_DAY + 1;
      const yieldRateValue: BigNumber =
          BigNumber.from("0x1000000000000000000000000000000000000000000000000000000000000");

      await proveTx(context.yieldStreamer.configureYieldRate(
          YIELD_STREAMER_INIT_DAY,
          INITIAL_YIELD_RATE
      ));

      await expect(context.yieldStreamer.updateYieldRate(
          effectiveDay,
          yieldRateValue,
          0
      )).revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240
      );
    });
  });

  describe("Function 'calculateYieldByDays()'", async () => {
    const balanceRecords: BalanceRecord[] = balanceRecordsCase1;
    const lookBackPeriodLength = LOOK_BACK_PERIOD_LENGTH;
    const dayFrom = YIELD_STREAMER_INIT_DAY + 2;
    const dayTo = balanceRecords[balanceRecords.length - 1].day + 1;
    const yieldByDaysBaseRequest: YieldByDaysRequest = {
      lookBackPeriodLength,
      yieldRateRecords: [yieldRateRecordCase1],
      balanceRecords,
      dayFrom,
      dayTo,
      claimDebit: BIG_NUMBER_ZERO,
    };

    async function checkYieldByDays(context: TestContext, yieldByDaysRequest: YieldByDaysRequest) {
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));
      for (let i = 1; i < yieldByDaysRequest.yieldRateRecords.length; ++i) {
        const yieldRateRecord: YieldRateRecord = yieldByDaysRequest.yieldRateRecords[i];
        await proveTx(context.yieldStreamer.configureYieldRate(yieldRateRecord.effectiveDay, yieldRateRecord.value));
      }

      const expectedYieldByDays: BigNumber[] = defineExpectedYieldByDays(yieldByDaysRequest);
      const actualYieldByDays: BigNumber[] = await context.yieldStreamer.calculateYieldByDays(
        user.address,
        dayFrom,
        dayTo,
        yieldByDaysRequest.claimDebit
      );
      expect(actualYieldByDays).to.deep.equal(expectedYieldByDays);
    }

    describe("Executes as expected if token balances are according to case 1 and", async () => {
      describe("There is only one yield record and", async () => {
        it("The claim debit is zero", async () => {
          const context: TestContext = await setUpFixture(deployAndConfigureContracts);
          const yieldByDaysRequest: YieldByDaysRequest = { ...yieldByDaysBaseRequest };
          await checkYieldByDays(context, yieldByDaysRequest);
        });

        it("The claim debit is non-zero and small", async () => {
          const context: TestContext = await setUpFixture(deployAndConfigureContracts);
          const yieldByDaysRequest: YieldByDaysRequest = { ...yieldByDaysBaseRequest };
          yieldByDaysRequest.claimDebit = BigNumber.from(123456);
          await checkYieldByDays(context, yieldByDaysRequest);
        });

        it("The claim debit is non-zero and huge", async () => {
          const context: TestContext = await setUpFixture(deployAndConfigureContracts);
          const yieldByDaysRequest: YieldByDaysRequest = { ...yieldByDaysBaseRequest };
          yieldByDaysRequest.claimDebit = BIG_NUMBER_MAX_UINT256;
          await checkYieldByDays(context, yieldByDaysRequest);
        });
      });

      describe("There are three yield records and", async () => {
        it("The claim debit is zero", async () => {
          const context: TestContext = await setUpFixture(deployAndConfigureContracts);
          const yieldByDaysRequest: YieldByDaysRequest = { ...yieldByDaysBaseRequest };
          yieldByDaysRequest.yieldRateRecords.push(yieldRateRecordCase2);
          yieldByDaysRequest.yieldRateRecords.push(yieldRateRecordCase3);
          await checkYieldByDays(context, yieldByDaysRequest);
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The 'to' day is prior the 'from' day", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const yieldByDaysRequest: YieldByDaysRequest = { ...yieldByDaysBaseRequest };
        await expect(
          context.yieldStreamer.calculateYieldByDays(
            user.address,
            dayFrom,
            dayFrom - 1,
            yieldByDaysRequest.claimDebit
          )).to.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY,
        );
      });
    });
  });

  describe("Function 'claimAllPreview()'", async () => {
    describe("Executes as expected if", async () => {
      const claimRequest: ClaimRequest = {
        amount: BIG_NUMBER_MAX_UINT256,
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 10,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecordsCase1
      };
      it("Token balances are according to case 1", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, claimRequest.balanceRecords));
        await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));
        const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const actualClaimResult = await context.yieldStreamer.claimAllPreview(user.address);
        compareClaimPreviews(actualClaimResult, expectedClaimResult);
      });
    });
  });

  describe("Function 'claimPreview()'", async () => {
    describe("Executes as expected if token balances are according to case 1 and", async () => {
      const baseClaimRequest: ClaimRequest = {
        amount: BIG_NUMBER_MAX_UINT256,
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 10,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecordsCase1
      };

      async function checkClaimPreview(context: TestContext, claimRequest: ClaimRequest) {
        await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, claimRequest.balanceRecords));
        await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));
        const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const actualClaimResult = await context.yieldStreamer.claimPreview(user.address, claimRequest.amount);
        compareClaimPreviews(actualClaimResult, expectedClaimResult);
      }

      it("The amount equals a half of the possible primary yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = roundDown(expectedClaimAllResult.primaryYield.div(2));
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount equals the possible primary yield plus a third of the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = roundDown(
          expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield.div(3))
        );
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount is greater than possible primary yield plus the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const expectedShortfall = roundUpward(BigNumber.from(1));

        claimRequest.amount = expectedClaimAllResult.yield.add(expectedShortfall);
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount equals the minimum allowed claim amount", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };

        claimRequest.amount = MIN_CLAIM_AMOUNT;
        await checkClaimPreview(context, claimRequest);
      });
    });
    describe("Is reverted if", async () => {
      it("The amount is bellow the allowed minimum", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await expect(
          context.yieldStreamer.claimPreview(user.address, MIN_CLAIM_AMOUNT.sub(1))
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_AMOUNT_BELOW_MINIMUM
        );
      });

      it("The amount is non-rounded", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await expect(
          context.yieldStreamer.claimPreview(user.address, MIN_CLAIM_AMOUNT.add(1))
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_AMOUNT_NON_ROUNDED
        );
      });
    });
  });

  describe("Function 'claim()'", async () => {
    const baseClaimRequest: ClaimRequest = {
      amount: BIG_NUMBER_MAX_UINT256,
      firstYieldDay: YIELD_STREAMER_INIT_DAY,
      claimDay: YIELD_STREAMER_INIT_DAY + 10,
      claimTime: 12 * 3600,
      claimDebit: BIG_NUMBER_ZERO,
      lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
      yieldRateRecords: [yieldRateRecordCase1],
      balanceRecords: balanceRecordsCase1
    };

    async function checkClaim(context: TestContext, claimRequest: ClaimRequest) {
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, claimRequest.balanceRecords));
      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));
      const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
      const totalYield: BigNumber = claimRequest.amount;
      const totalYieldWithoutFee: BigNumber = totalYield.sub(expectedClaimResult.fee);
      const tx: TransactionResponse = await context.yieldStreamer.connect(user).claim(claimRequest.amount);

      await expect(tx).to.emit(context.yieldStreamer, EVENT_CLAIM).withArgs(
        user.address,
        totalYield,
        expectedClaimResult.fee
      );

      await expect(tx).to.changeTokenBalances(
        context.tokenMock,
        [context.yieldStreamer, user, feeReceiver],
        [BIG_NUMBER_ZERO.sub(totalYield), totalYieldWithoutFee, expectedClaimResult.fee],
      );

      const actualClaimState = await context.yieldStreamer.getLastClaimDetails(user.address);
      expect(actualClaimState.day).to.equal(expectedClaimResult.nextClaimDay);
      expect(actualClaimState.debit).to.equal(expectedClaimResult.nextClaimDebit);
    }

    describe("Executes as expected if token balances are according to case 1 and", async () => {
      it("The amount equals a half of the possible primary yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = roundDown(expectedClaimAllResult.primaryYield.div(2));
        await checkClaim(context, claimRequest);
      });

      it("The amount equals the possible primary yield plus a half of the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = roundDown(
          expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield.div(2))
        );
        await checkClaim(context, claimRequest);
      });

      it("The amount equals the minimum allowed claim amount", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };

        claimRequest.amount = MIN_CLAIM_AMOUNT;
        await checkClaim(context, claimRequest);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await proveTx(context.yieldStreamer.setPauser(deployer.address));
        await proveTx(context.yieldStreamer.pause());

        await expect(
          context.yieldStreamer.connect(user).claim(0)
        ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("The user is blacklisted", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await proveTx(context.yieldStreamer.connect(user).selfBlacklist());

        await expect(
          context.yieldStreamer.connect(user).claim(0)
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_BLACKLISTED_ACCOUNT
        ).withArgs(
          user.address
        );
      });

      it("The amount is greater than possible primary yield plus the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const expectedShortfall = roundUpward(BigNumber.from(1));

        claimRequest.amount = expectedClaimAllResult.yield.add(expectedShortfall);

        await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, claimRequest.balanceRecords));
        await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

        await expect(
          context.yieldStreamer.connect(user).claim(claimRequest.amount)
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_REJECTION_DUE_TO_SHORTFALL
        );
      });

      it("The amount is bellow the allowed minimum", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await expect(
          context.yieldStreamer.connect(user).claim(MIN_CLAIM_AMOUNT.sub(1))
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_AMOUNT_BELOW_MINIMUM
        );
      });

      it("The amount is non-rounded", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await expect(
          context.yieldStreamer.connect(user).claim(MIN_CLAIM_AMOUNT.add(1))
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_AMOUNT_NON_ROUNDED
        );
      });
    });
  });

  describe("Complex claim scenarios", async () => {

    async function executeAndCheckPartialClaim(context: TestContext, claimRequest: ClaimRequest) {
      const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
      const expectedClaimAllResult: ClaimResult = defineExpectedClaimAllResult(claimRequest);
      const actualClaimResult = await context.yieldStreamer.claimPreview(user.address, claimRequest.amount);
      const actualClaimAllResult = await context.yieldStreamer.claimAllPreview(user.address);
      compareClaimPreviews(actualClaimResult, expectedClaimResult);
      compareClaimPreviews(actualClaimAllResult, expectedClaimAllResult);

      const totalYield: BigNumber = claimRequest.amount;
      const totalYieldWithoutFee: BigNumber = totalYield.sub(expectedClaimResult.fee);

      const tx: TransactionResponse = await context.yieldStreamer.connect(user).claim(claimRequest.amount);

      await expect(tx).to.emit(context.yieldStreamer, EVENT_CLAIM).withArgs(
        user.address,
        totalYield,
        expectedClaimResult.fee
      );

      await expect(tx).to.changeTokenBalances(
        context.tokenMock,
        [context.yieldStreamer, user, feeReceiver],
        [BIG_NUMBER_ZERO.sub(totalYield), totalYieldWithoutFee, expectedClaimResult.fee],
      );

      return expectedClaimResult;
    }

    function defineYieldForFirstClaimDay(context: TestContext, claimRequest: ClaimRequest): BigNumber {
      return defineExpectedYieldByDays({
        lookBackPeriodLength: claimRequest.lookBackPeriodLength,
        yieldRateRecords: claimRequest.yieldRateRecords,
        balanceRecords: claimRequest.balanceRecords,
        dayFrom: claimRequest.firstYieldDay,
        dayTo: claimRequest.firstYieldDay,
        claimDebit: claimRequest.claimDebit
      })[0];
    }

    const balanceRecords: BalanceRecord[] = balanceRecordsCase1;

    const baseClaimRequest: ClaimRequest = {
      amount: BIG_NUMBER_MAX_UINT256,
      firstYieldDay: YIELD_STREAMER_INIT_DAY,
      claimDay: YIELD_STREAMER_INIT_DAY + 10,
      claimTime: 12 * 3600,
      claimDebit: BIG_NUMBER_ZERO,
      lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
      yieldRateRecords: [yieldRateRecordCase1],
      balanceRecords: balanceRecords
    };

    it("Case 1: three consecutive partial claims, never stop at the same day", async () => {
      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = { ...baseClaimRequest };
      claimRequest.amount = MIN_CLAIM_AMOUNT;
      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      let claimResult: ClaimResult = await executeAndCheckPartialClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = claimResult.nextClaimDebit;
      claimRequest.amount = roundDown(
        defineYieldForFirstClaimDay(context, claimRequest).sub(claimResult.nextClaimDebit).add(MIN_CLAIM_AMOUNT)
      );

      let previousClaimResult = claimResult;
      claimResult = await executeAndCheckPartialClaim(context, claimRequest);

      expect(previousClaimResult.firstYieldDay).to.not.equal(
        claimResult.firstYieldDay,
        "Claim 1 and claim 2 happened at the same day. Change the test conditions"
      );

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = claimResult.nextClaimDebit;
      claimRequest.amount = roundDown(
        defineYieldForFirstClaimDay(context, claimRequest).sub(claimResult.nextClaimDebit).add(MIN_CLAIM_AMOUNT)
      );

      previousClaimResult = claimResult;
      claimResult = await executeAndCheckPartialClaim(context, claimRequest);

      expect(previousClaimResult.firstYieldDay).to.not.equal(
        claimResult.firstYieldDay,
        "Claim 2 and claim 3 happened at the same day. Change the test conditions"
      );
    });

    it("Case 2: four consecutive partial claims, two stop at some day, two stop at yesterday, then revert", async () => {
      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = { ...baseClaimRequest };

      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      const expectedClaimAllResult: ClaimResult = defineExpectedClaimAllResult(claimRequest);

      claimRequest.amount = roundDown(expectedClaimAllResult.primaryYield.div(2));

      let expectedClaimResult: ClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).not.equal(
        claimRequest.claimDay - 1,
        "The next claim day after claim 1 is yesterday but it must be earlier. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = MIN_CLAIM_AMOUNT;

      let previousExpectedClaimResult = expectedClaimResult;
      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).to.equal(
        previousExpectedClaimResult.nextClaimDay,
        "The next yield day must be the same for claim 1 and claim 2. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = roundDown(expectedClaimResult.primaryYield.add(ROUNDING_COEF));

      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).equal(
        claimRequest.claimDay - 1,
        "The next claim day after claim 3 is not yesterday but it must be. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = MIN_CLAIM_AMOUNT;

      previousExpectedClaimResult = expectedClaimResult;
      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).to.equal(
        previousExpectedClaimResult.nextClaimDay,
        "The next yield day must be the same for claim 3 and claim 4. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = USER_CURRENT_TOKEN_BALANCE;

      expectedClaimResult = defineExpectedClaimResult(claimRequest);
      const actualClaimResult = await context.yieldStreamer.claimPreview(user.address, claimRequest.amount);
      compareClaimPreviews(actualClaimResult, expectedClaimResult);

      await expect(context.yieldStreamer.connect(user).claim(claimRequest.amount)).to.be.revertedWithCustomError(
        context.yieldStreamer,
        REVERT_ERROR_CLAIM_REJECTION_DUE_TO_SHORTFALL,
      ).withArgs(
        expectedClaimResult.shortfall
      );
    });

    it("Case 3: a partial claim that stops at yesterday, then check claim all", async () => {
      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = { ...baseClaimRequest };
      claimRequest.claimTime = 23 * 3600 + 3599;

      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      let expectedClaimAllResult: ClaimResult = defineExpectedClaimAllResult(claimRequest);

      claimRequest.amount = roundDown(expectedClaimAllResult.yield.sub(MIN_CLAIM_AMOUNT.mul(1)));

      const expectedClaimResult: ClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).equal(
        claimRequest.claimDay - 1,
        "The next claim day after claim 1 is not yesterday but it must be. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      expectedClaimAllResult = defineExpectedClaimAllResult(claimRequest);
      const actualClaimAllResult = await context.yieldStreamer.claimAllPreview(user.address);
      compareClaimPreviews(actualClaimAllResult, expectedClaimAllResult);
      expect(expectedClaimAllResult.claimDebitIsGreaterThanFirstDayYield).to.equal(
        true,
        "The claim debit is not greater that the yield, but it must be. Change the test conditions"
      );
    });

    it("Case 4: a situation when claim debit is greater than the first day yield", async () => {
      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = { ...baseClaimRequest };

      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      let expectedClaimAllResult: ClaimResult = defineExpectedClaimAllResult(claimRequest);

      claimRequest.amount = roundDown(expectedClaimAllResult.primaryYield.sub(MIN_CLAIM_AMOUNT));

      const expectedClaimResult: ClaimResult = await executeAndCheckPartialClaim(context, claimRequest);
      expect(expectedClaimResult.nextClaimDay).not.equal(
        claimRequest.claimDay - 1,
        "The next claim day after the claim is yesterday but it must not be. Change the test conditions"
      );

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      expectedClaimAllResult = defineExpectedClaimAllResult(claimRequest);
      const actualClaimAllResult = await context.yieldStreamer.claimAllPreview(user.address);
      compareClaimPreviews(actualClaimAllResult, expectedClaimAllResult);
      expect(expectedClaimAllResult.claimDebitIsGreaterThanFirstDayYield).to.equal(
        true,
        "The claim debit is not greater that the first day yield, but it must be. Change the test conditions"
      );
    });
  });

  describe("Function 'getDailyBalancesWithYield()'", async () => {
    const balanceRecords: BalanceRecord[] = balanceRecordsCase1;
    const balanceWithYieldByDaysRequestBase: BalanceWithYieldByDaysRequest = {
      lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
      yieldRateRecords: [yieldRateRecordCase1],
      balanceRecords: balanceRecords,
      dayFrom: YIELD_STREAMER_INIT_DAY,
      dayTo: YIELD_STREAMER_INIT_DAY,
      claimDebit: BIG_NUMBER_ZERO,
      firstYieldDay: YIELD_STREAMER_INIT_DAY,
    };

    const currentDay: number = YIELD_STREAMER_INIT_DAY + 10;
    const currentTime: number = 12 * 3600;

    const claimRequestBase: ClaimRequest = {
      amount: BIG_NUMBER_MAX_UINT256,
      firstYieldDay: YIELD_STREAMER_INIT_DAY,
      claimDay: currentDay,
      claimTime: currentTime,
      claimDebit: BIG_NUMBER_ZERO,
      lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
      yieldRateRecords: [yieldRateRecordCase1],
      balanceRecords: balanceRecordsCase1
    };

    async function checkGetDailyBalancesWithYield(props: {
      firstDayRangeRelativeToNexClaimDay: number,
      lastDayRangeRelativeToNexClaimDay: number,
      executeClaimPriorTheCall: boolean,
    }) {
      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));
      await proveTx(context.balanceTrackerMock.setDayAndTime(currentDay, currentTime));
      const claimRequest: ClaimRequest = { ...claimRequestBase };
      const expectedClaimAllResult: ClaimResult = defineExpectedClaimAllResult(claimRequest);
      if (props.executeClaimPriorTheCall) {
        claimRequest.amount = roundDown(expectedClaimAllResult.primaryYield.div(2));
        await proveTx(await context.yieldStreamer.connect(user).claim(claimRequest.amount));
      }
      const claimState: ClaimState = await context.yieldStreamer.getLastClaimDetails(user.address);

      const balanceWithYieldByDaysRequest: BalanceWithYieldByDaysRequest = { ...balanceWithYieldByDaysRequestBase };
      const nextClaimDay: number = claimState.day || YIELD_STREAMER_INIT_DAY;
      balanceWithYieldByDaysRequest.firstYieldDay = nextClaimDay;
      balanceWithYieldByDaysRequest.claimDebit = claimState.debit;
      balanceWithYieldByDaysRequest.dayFrom = nextClaimDay + props.firstDayRangeRelativeToNexClaimDay;
      balanceWithYieldByDaysRequest.dayTo = nextClaimDay + props.lastDayRangeRelativeToNexClaimDay;

      const expectedBalanceWithYieldByDays: BigNumber[] =
        defineExpectedBalanceWithYieldByDays(balanceWithYieldByDaysRequest);
      const actualBalanceWithYieldByDays = await context.yieldStreamer.getDailyBalancesWithYield(
        user.address,
        balanceWithYieldByDaysRequest.dayFrom,
        balanceWithYieldByDaysRequest.dayTo
      );
      expect(actualBalanceWithYieldByDays).to.deep.equal(expectedBalanceWithYieldByDays);
    }


    describe("Executes as expected if", async () => {
      describe("There was a claim made by the account and", async () => {
        it("Argument 'fromDay' is prior the next claim day and `toDay` is after the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: -(LOOK_BACK_PERIOD_LENGTH + 1),
            lastDayRangeRelativeToNexClaimDay: +(LOOK_BACK_PERIOD_LENGTH + 1),
            executeClaimPriorTheCall: true
          });
        });
        it("Arguments 'fromDay', `toDay` are both prior the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: -(LOOK_BACK_PERIOD_LENGTH + 1),
            lastDayRangeRelativeToNexClaimDay: -1,
            executeClaimPriorTheCall: true
          });
        });
        it("Arguments 'fromDay', `toDay` are both after the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: +1,
            lastDayRangeRelativeToNexClaimDay: +(LOOK_BACK_PERIOD_LENGTH + 1),
            executeClaimPriorTheCall: true
          });
        });
        it("Arguments 'fromDay', `toDay` are both equal to the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: 0,
            lastDayRangeRelativeToNexClaimDay: 0,
            executeClaimPriorTheCall: true
          });
        });
      });
      describe("There were no claims made by the account and", async () => {
        it("Argument 'fromDay' is prior the next claim day and `toDay` is after the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: -(YIELD_STREAMER_INIT_DAY - BALANCE_TRACKER_INIT_DAY),
            lastDayRangeRelativeToNexClaimDay: +10,
            executeClaimPriorTheCall: false
          });
        });
        it("Arguments 'fromDay', `toDay` are both prior the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: -1,
            lastDayRangeRelativeToNexClaimDay: -1,
            executeClaimPriorTheCall: false
          });
        });
        it("Arguments 'fromDay', `toDay` are both after the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: +1,
            lastDayRangeRelativeToNexClaimDay: +1,
            executeClaimPriorTheCall: false
          });
        });
        it("Arguments 'fromDay', `toDay` are both equal to the next claim day", async () => {
          await checkGetDailyBalancesWithYield({
            firstDayRangeRelativeToNexClaimDay: 0,
            lastDayRangeRelativeToNexClaimDay: 0,
            executeClaimPriorTheCall: false
          });
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The 'to' day is prior the 'from' day", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        await expect(
          context.yieldStreamer.getDailyBalancesWithYield(
            user.address,
            balanceWithYieldByDaysRequestBase.dayFrom,
            balanceWithYieldByDaysRequestBase.dayFrom - 1,
          )).to.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY,
        );
      });
    });
  });
});
