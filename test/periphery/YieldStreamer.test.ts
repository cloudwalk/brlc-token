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
const INITIAL_YIELD_RATE_IN_PPM = 100000000; // 0.01%
const BALANCE_TRACKER_INIT_DAY = 100;
const YIELD_STREAMER_INIT_DAY = BALANCE_TRACKER_INIT_DAY + LOOK_BACK_PERIOD_LENGTH - 1;
const FEE_RATE: BigNumber = BigNumber.from(225000000000);
const RATE_FACTOR: BigNumber = BigNumber.from(1000000000000);

interface TestContext {
  tokenMock: Contract;
  balanceTrackerMock: Contract;
  yieldStreamer: Contract;
}

interface L {
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
  balanceRecords: L[],
}

interface YieldByDaysRequest {
  lookBackPeriodLength: number,
  yieldRateRecords: YieldRateRecord[],
  balanceRecords: L[],
  dayFrom: number,
  dayTo: number,
  claimDebit: BigNumber,
}

const balanceRecordsCase1: L[] = [
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
  value: BigNumber.from(INITIAL_YIELD_RATE_IN_PPM),
};

const yieldRateRecordCase2: YieldRateRecord = {
  effectiveDay: YIELD_STREAMER_INIT_DAY + 4,
  value: BigNumber.from(INITIAL_YIELD_RATE_IN_PPM * 2),
};

const yieldRateRecordCase3: YieldRateRecord = {
  effectiveDay: YIELD_STREAMER_INIT_DAY + 6,
  value: BigNumber.from(INITIAL_YIELD_RATE_IN_PPM * 3),
};

function defineExpectedDailyBalances(balanceRecords: L[], dayFrom: number, dayTo: number): BigNumber[] {
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

function calculateFee(amount: BigNumber, passedDays: number): BigNumber {
  if (passedDays >= 0) {
    return amount.mul(FEE_RATE).div(RATE_FACTOR);
  } else {
    return  BIG_NUMBER_ZERO;
  }
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
  let fee: BigNumber = BIG_NUMBER_ZERO;

  if (dayFrom !== dayTo) {
    if (yieldByDays[0].gt(claimRequest.claimDebit)) {
      yieldByDays[0] = yieldByDays[0].sub(claimRequest.claimDebit);
    } else {
      yieldByDays[0] = BIG_NUMBER_ZERO;
    }
  }

  let primaryYield = BIG_NUMBER_ZERO;
  for (let i = 0; i < lastIndex; ++i) {
    const yieldValue = yieldByDays[i];
    primaryYield = primaryYield.add(yieldValue);
    if (!primaryYieldReachedAmount) {
      fee = fee.add(calculateFee(yieldValue, lastIndex - i));
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
    if (partialLastYield.gt(claimRequest.claimDebit)) {
      streamYield = partialLastYield.sub(claimRequest.claimDebit);
    } else {
      streamYield = BIG_NUMBER_ZERO;
    }
    nextClaimDay = dayTo;
    if (claimRequest.amount.gt(streamYield)) {
      nextClaimDebit = claimRequest.claimDebit.add(streamYield);
    } else {
      nextClaimDebit = claimRequest.claimDebit.add(claimRequest.amount);
    }
    fee = fee.add(calculateFee(nextClaimDebit.sub(claimRequest.claimDebit), 0));
  } else {
    streamYield = partialLastYield;
    if (primaryYieldReachedAmount) {
      nextClaimDay = dayFrom + indexWhenPrimaryYieldReachedAmount;
      const yieldSurplus: BigNumber = valueWhenPrimaryYieldReachedAmount.sub(claimRequest.amount);
      nextClaimDebit = yieldByDays[indexWhenPrimaryYieldReachedAmount].sub(yieldSurplus);
      if (indexWhenPrimaryYieldReachedAmount === 0) {
        nextClaimDebit = nextClaimDebit.add(claimRequest.claimDebit);
      }
      fee = fee.sub(calculateFee(yieldSurplus, lastIndex - indexWhenPrimaryYieldReachedAmount));
    } else {
      nextClaimDay = dayTo;
      const amountSurplus: BigNumber = claimRequest.amount.sub(primaryYield);
      if (partialLastYield.gt(amountSurplus)) {
        nextClaimDebit = amountSurplus;
      } else {
        nextClaimDebit = partialLastYield;
      }
      fee = fee.add(calculateFee(nextClaimDebit, 0));
    }
  }

  const totalYield = primaryYield.add(streamYield);
  let shortfall: BigNumber = BIG_NUMBER_ZERO;
  if (claimRequest.amount.lt(BIG_NUMBER_MAX_UINT256) && claimRequest.amount.gt(totalYield)) {
    shortfall = claimRequest.amount.sub(totalYield);
  }

  return {
    nextClaimDay: BigNumber.from(nextClaimDay),
    nextClaimDebit: nextClaimDebit,
    firstYieldDay: BigNumber.from(dayFrom),
    prevClaimDebit: claimRequest.claimDebit,
    streamYield,
    primaryYield,
    lastDayYield: lastYield,
    shortfall,
    fee
  };
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


describe("Contract 'YieldStreamer'", async () => {

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";

  const REVERT_ERROR_CLAIM_REJECTION_DUE_TO_SHORTFALL = "ClaimRejectionDueToShortfall";

  const EVENT_CLAIM = "Claim";
  const EVENT_LOOK_BACK_PERIOD_CONFIGURED = "LookBackPeriodConfigured";
  const EVENT_YIELD_RATE_CONFIGURED = "YieldRateConfigured";

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
    await proveTx(yieldStreamer.configureYieldRate(YIELD_STREAMER_INIT_DAY, INITIAL_YIELD_RATE_IN_PPM));
    await proveTx(yieldStreamer.configureLookBackPeriod(YIELD_STREAMER_INIT_DAY, LOOK_BACK_PERIOD_LENGTH));
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

  describe(" Function 'configureLookBackPeriod()'", async () => {
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
  });

  describe(" Function 'configureYieldRate()'", async () => {
    it("Executes as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const expectedYieldRateRecord1: YieldRateRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY,
        value: BigNumber.from(INITIAL_YIELD_RATE_IN_PPM)
      };
      const expectedYieldRateRecord2: YieldRateRecord = {
        effectiveDay: YIELD_STREAMER_INIT_DAY + 3,
        value: BigNumber.from(INITIAL_YIELD_RATE_IN_PPM * 2)
      };

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
  });

  describe(" Function 'calculateYieldByDays()'", async () => {
    const balanceRecords: L[] = balanceRecordsCase1;
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
  });

  describe(" Function 'claimAllPreview()'", async () => {
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

  describe(" Function 'claimPreview()'", async () => {
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

        claimRequest.amount = expectedClaimAllResult.primaryYield.div(2);
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount equals the possible primary yield plus a third of the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield.div(3));
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount is greater than possible primary yield plus the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const expectedShortfall = 1;

        claimRequest.amount =
          expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield).add(expectedShortfall);
        await checkClaimPreview(context, claimRequest);
      });

      it("The amount equals zero", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };

        claimRequest.amount = BIG_NUMBER_ZERO;
        await checkClaimPreview(context, claimRequest);
      });
    });
  });

  describe("Function 'claimAll()'", async () => {
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
        const totalYield: BigNumber = expectedClaimResult.primaryYield.add(expectedClaimResult.streamYield);
        const totalYieldWithoutFee: BigNumber = totalYield.sub(expectedClaimResult.fee);
        const tx: TransactionResponse = await context.yieldStreamer.connect(user).claimAll();

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
      });
    });
  });

  describe(" Function 'claim()'", async () => {
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

        claimRequest.amount = expectedClaimAllResult.primaryYield.div(2);
        await checkClaim(context, claimRequest);
      });

      it("The amount equals the possible primary yield plus a half of the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);

        claimRequest.amount = expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield.div(2));
        await checkClaim(context, claimRequest);
      });

      it("The amount equals zero", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };

        claimRequest.amount = BIG_NUMBER_ZERO;
        await checkClaim(context, claimRequest);
      });
    });

    describe("Is reverted if", async () => {
      it("The amount is greater than possible primary yield plus the possible stream yield", async () => {
        const context: TestContext = await setUpFixture(deployAndConfigureContracts);
        const claimRequest: ClaimRequest = { ...baseClaimRequest };
        claimRequest.amount = BIG_NUMBER_MAX_UINT256;
        const expectedClaimAllResult: ClaimResult = defineExpectedClaimResult(claimRequest);
        const expectedShortfall = 1;

        claimRequest.amount =
          expectedClaimAllResult.primaryYield.add(expectedClaimAllResult.streamYield).add(expectedShortfall);

        await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, claimRequest.balanceRecords));
        await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

        await expect(
          context.yieldStreamer.connect(user).claim(claimRequest.amount)
        ).to.be.revertedWithCustomError(
          context.yieldStreamer,
          REVERT_ERROR_CLAIM_REJECTION_DUE_TO_SHORTFALL
        );
      });
    });
  });

  describe("Complex claim scenarios", async () => {
    async function executeAndCheckFullClaim(context: TestContext, claimRequest: ClaimRequest) {
      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
      const actualClaimResult = await context.yieldStreamer.claimAllPreview(user.address);
      compareClaimPreviews(actualClaimResult, expectedClaimResult);

      const totalYield: BigNumber = expectedClaimResult.primaryYield.add(expectedClaimResult.streamYield);
      const totalYieldWithoutFee: BigNumber = totalYield.sub(expectedClaimResult.fee);

      const tx: TransactionResponse = await context.yieldStreamer.connect(user).claimAll();

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

    async function executeAndCheckPartialClaim(context: TestContext, claimRequest: ClaimRequest) {
      const expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);
      const actualClaimResult = await context.yieldStreamer.claimPreview(user.address, claimRequest.amount);
      compareClaimPreviews(actualClaimResult, expectedClaimResult);

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

    it("Case 1: three consecutive full claims, never on the same day", async () => {
      const balanceRecords: L[] = balanceRecordsCase1;

      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = {
        amount: BIG_NUMBER_MAX_UINT256,
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 3,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecords
      };

      let claimResult: ClaimResult = await executeAndCheckFullClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDay += 2;
      claimRequest.claimTime += 2 * 3600;
      claimRequest.claimDebit = claimResult.nextClaimDebit;

      claimResult = await executeAndCheckFullClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDay += 6;
      claimRequest.claimTime += 4 * 3600;
      claimRequest.claimDebit = claimResult.nextClaimDebit;

      await executeAndCheckFullClaim(context, claimRequest);
    });

    it("Case 2: three consecutive full claims, the last two are at the same day", async () => {
      const balanceRecords: L[] = balanceRecordsCase1;

      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = {
        amount: BIG_NUMBER_MAX_UINT256,
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 9,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecords
      };

      let claimResult: ClaimResult = await executeAndCheckFullClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimTime += 2 * 3600;
      claimRequest.claimDebit = claimResult.nextClaimDebit;

      claimResult = await executeAndCheckFullClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimTime += 4 * 3600;
      claimRequest.claimDebit = claimResult.nextClaimDebit;

      await executeAndCheckFullClaim(context, claimRequest);
    });

    it("Case 3: three consecutive partial claims, never on the same day", async () => {
      const balanceRecords: L[] = balanceRecordsCase1;

      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = {
        amount: BigNumber.from(123456),
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 10,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecords
      };
      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      let claimResult: ClaimResult = await executeAndCheckPartialClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = claimResult.nextClaimDebit;
      claimRequest.amount = defineYieldForFirstClaimDay(context, claimRequest).sub(claimResult.nextClaimDebit).add(1);

      claimResult = await executeAndCheckPartialClaim(context, claimRequest);

      claimRequest.firstYieldDay = claimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = claimResult.nextClaimDebit;
      claimRequest.amount = defineYieldForFirstClaimDay(context, claimRequest).sub(claimResult.nextClaimDebit).add(1);

      await executeAndCheckPartialClaim(context, claimRequest);
    });

    it("Case 4: three consecutive partial claims, the two three are at the same day, then revert", async () => {
      const balanceRecords: L[] = balanceRecordsCase1;

      const context: TestContext = await setUpFixture(deployAndConfigureContracts);
      await proveTx(context.balanceTrackerMock.setBalanceRecords(user.address, balanceRecords));

      const claimRequest: ClaimRequest = {
        amount: BIG_NUMBER_MAX_UINT256,
        firstYieldDay: YIELD_STREAMER_INIT_DAY,
        claimDay: YIELD_STREAMER_INIT_DAY + 10,
        claimTime: 12 * 3600,
        claimDebit: BIG_NUMBER_ZERO,
        lookBackPeriodLength: LOOK_BACK_PERIOD_LENGTH,
        yieldRateRecords: [yieldRateRecordCase1],
        balanceRecords: balanceRecords
      };
      await proveTx(context.balanceTrackerMock.setDayAndTime(claimRequest.claimDay, claimRequest.claimTime));

      let expectedClaimResult: ClaimResult = defineExpectedClaimResult(claimRequest);

      claimRequest.amount = expectedClaimResult.primaryYield.add(1);

      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = BigNumber.from(1);

      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);

      claimRequest.firstYieldDay = expectedClaimResult.nextClaimDay.toNumber();
      claimRequest.claimDebit = expectedClaimResult.nextClaimDebit;
      claimRequest.amount = BigNumber.from(1);

      expectedClaimResult = await executeAndCheckPartialClaim(context, claimRequest);

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
  });

});
