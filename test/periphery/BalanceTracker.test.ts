import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { Block, TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider";
import { proveTx } from "../../test-utils/eth";

const HOUR_IN_SECONDS = 3600;
const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS;
const NEGATIVE_TIME_SHIFT = 3 * HOUR_IN_SECONDS;
const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZERO_BIG_NUMBER = ethers.constants.Zero;
const INIT_TOKEN_BALANCE: BigNumber = BigNumber.from(1000_000_000_000);
const SERVICE_ACCOUNT_SPECIAL_TOKEN_BALANCE: BigNumber = BigNumber.from(10_000_000_000);
const SERVICE_ACCOUNT_ADDRESS = "0xf128B6142D65fBF539a5204561da920602fe34c3";
const SERVICE_START_DAY = 19703; // The date: 2023-12-12

interface BalanceRecord {
  accountAddress: string;
  index: number;
  day: number;
  value: BigNumber;
}

interface TokenTransfer {
  executionDay: number;
  addressFrom: string;
  addressTo: string;
  amount: BigNumber;
}

interface BalanceChange {
  executionDay: number;
  address: string;
  amountChange: BigNumber;
}

interface TestContext {
  balanceTracker: Contract;
  balanceTrackerInitDay: number;
  balanceByAddressMap: Map<string, BigNumber>;
  balanceRecordsByAddressMap: Map<string, BalanceRecord[]>;
}

interface DailyBalancesRequest {
  address: string,
  dayFrom: number,
  dayTo: number,
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

function toDayAndTime(timestampInSeconds: number): { dayIndex: number, secondsOfDay: number } {
  const correctedTimestamp = timestampInSeconds - NEGATIVE_TIME_SHIFT;
  const dayIndex = Math.floor(correctedTimestamp / DAY_IN_SECONDS);
  const secondsOfDay = correctedTimestamp % DAY_IN_SECONDS;
  return {
    dayIndex,
    secondsOfDay,
  };
}

function toDayIndex(timestampInSeconds: number): number {
  const { dayIndex } = toDayAndTime(timestampInSeconds);
  return dayIndex;
}

async function getTxDayIndex(txReceipt: TransactionReceipt): Promise<number> {
  const block: Block = await ethers.provider.getBlock(txReceipt.blockNumber);
  return toDayIndex(block.timestamp);
}

async function increaseBlockchainTimeToSpecificRelativeDay(relativeDay: number) {
  relativeDay = Math.floor(relativeDay);
  if (relativeDay < 1) {
    return;
  }
  const currentTimestampInSeconds: number = await time.latest();
  const { secondsOfDay } = toDayAndTime(currentTimestampInSeconds);
  await time.increase(DAY_IN_SECONDS - secondsOfDay + (relativeDay - 1) * DAY_IN_SECONDS + 1);
}

function toBalanceChanges(tokenTransfer: TokenTransfer): BalanceChange[] {
  const addressFromBalanceChange: BalanceChange = {
    executionDay: tokenTransfer.executionDay,
    address: tokenTransfer.addressFrom,
    amountChange: ZERO_BIG_NUMBER.sub(tokenTransfer.amount),
  };
  const addressToBalanceChange: BalanceChange = {
    executionDay: tokenTransfer.executionDay,
    address: tokenTransfer.addressTo,
    amountChange: tokenTransfer.amount,
  };
  return [addressFromBalanceChange, addressToBalanceChange];
}

async function checkBalanceRecordsForAccount(
  balanceTracker: Contract,
  accountAddress: string,
  expectedBalanceRecords: BalanceRecord[]
) {
  const expectedRecordArrayLength = expectedBalanceRecords.length;
  if (expectedRecordArrayLength == 0) {
    const actualBalanceRecordState = await balanceTracker.readBalanceRecord(accountAddress, 0);
    const actualBalanceRecord = actualBalanceRecordState[0];
    const actualRecordArrayLength: number = actualBalanceRecordState[1].toNumber();
    expect(actualRecordArrayLength).to.equal(
      expectedRecordArrayLength,
      `Wrong record balance array length for account ${accountAddress}. The array should be empty`
    );
    expect(actualBalanceRecord.day).to.equal(
      0,
      `Wrong field 'balanceRecord[0].day' for empty balance record array of account ${accountAddress}`
    );
    expect(actualBalanceRecord.value).to.equal(
      0,
      `Wrong field 'balanceRecord[0].value' for empty balance record array of account ${accountAddress}`
    );
  } else {
    for (let i = 0; i < expectedRecordArrayLength; ++i) {
      const expectedBalanceRecord: BalanceRecord = expectedBalanceRecords[i];
      const actualBalanceRecordState = await balanceTracker.readBalanceRecord(accountAddress, i);
      const actualBalanceRecord = actualBalanceRecordState[0];
      const actualRecordArrayLength: number = actualBalanceRecordState[1].toNumber();
      expect(actualRecordArrayLength).to.equal(
        expectedRecordArrayLength,
        `Wrong record balance array length for account ${accountAddress}`
      );
      expect(actualBalanceRecord.day).to.equal(
        expectedBalanceRecord.day,
        `Wrong field 'balanceRecord[${i}].day' for account ${accountAddress}`
      );
      expect(actualBalanceRecord.value).to.equal(
        expectedBalanceRecord.value,
        `Wrong field 'balanceRecord[${i}].value' for account ${accountAddress}`
      );
    }
  }
}

function applyBalanceChange(
  context: TestContext,
  balanceChange: BalanceChange,
): BalanceRecord | undefined {
  const { address, amountChange } = balanceChange;
  const { balanceByAddressMap, balanceRecordsByAddressMap } = context;
  if (address == ZERO_ADDRESS || amountChange.eq(ZERO_BIG_NUMBER)) {
    return undefined;
  }
  const balance: BigNumber = balanceByAddressMap.get(address) ?? INIT_TOKEN_BALANCE;
  balanceByAddressMap.set(address, balance.add(amountChange));
  const balanceRecords: BalanceRecord[] = balanceRecordsByAddressMap.get(address) ?? [];
  let newBalanceRecord: BalanceRecord | undefined = {
    accountAddress: address,
    index: 0,
    day: balanceChange.executionDay - 1,
    value: balance,
  };
  if (balanceRecords.length === 0) {
    if (balanceChange.executionDay === context.balanceTrackerInitDay) {
      newBalanceRecord = undefined;
    } else {
      balanceRecords.push(newBalanceRecord);
    }
  } else {
    const lastRecord: BalanceRecord = balanceRecords[balanceRecords.length - 1];
    if (lastRecord.day == newBalanceRecord.day) {
      newBalanceRecord = undefined;
    } else {
      newBalanceRecord.index = lastRecord + 1;
      balanceRecords.push(newBalanceRecord);
    }
  }
  balanceRecordsByAddressMap.set(address, balanceRecords);
  return newBalanceRecord;
}

function defineExpectedDailyBalances(context: TestContext, dailyBalancesRequest: DailyBalancesRequest): BigNumber[] {
  const { address, dayFrom, dayTo } = dailyBalancesRequest;
  const balanceRecords: BalanceRecord[] = context.balanceRecordsByAddressMap.get(address) ?? [];
  const currentBalance: BigNumber = context.balanceByAddressMap.get(address) ?? ZERO_BIG_NUMBER;
  if (dayFrom < context.balanceTrackerInitDay) {
    throw new Error(
      `Cannot define daily balances because 'dayFrom' is less than the BalanceTracker init day. ` +
      `The 'dayFrom' value: ${dayFrom}. The init day: ${context.balanceTrackerInitDay}`
    );
  }
  if (dayFrom > dayTo) {
    throw new Error(
      `Cannot define daily balances because 'dayFrom' is greater than 'dayTo'. ` +
      `The 'dayFrom' value: ${dayFrom}. The 'dayTo' value: ${dayTo}`
    );
  }
  const dailyBalances: BigNumber[] = [];
  if (balanceRecords.length === 0) {
    for (let day = dayFrom; day <= dayTo; ++day) {
      dailyBalances.push(currentBalance);
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
        dailyBalances.push(currentBalance);
      } else {
        dailyBalances.push(balanceRecords[recordIndex].value);
      }
    }
  }
  return dailyBalances;
}

async function deployTokenMock(tokenMock: Contract): Promise<Contract> {
  const tokenMockFactory: ContractFactory = await ethers.getContractFactory("ERC20MockForBalanceTracker");
  tokenMock = await tokenMockFactory.deploy();
  await tokenMock.deployed();
  return tokenMock;
}

describe("Contract 'BalanceTracker'", async () => {

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";

  const REVERT_ERROR_UNAUTHORIZED_CALLER = "UnauthorizedCaller";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16 = "SafeCastOverflowUint16";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240 = "SafeCastOverflowUint240";
  const REVERT_ERROR_FROM_DAY_PRIOR_INIT_DAY = "FromDayPriorInitDay";
  const REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY = "ToDayPriorFromDay";

  let balanceTrackerFactory: ContractFactory;
  let tokenMock: Contract;
  let deployer: SignerWithAddress;
  let attacker: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  before(async () => {
    if (network.name !== "hardhat") {
      throw new Error(
        "This tests cannot be run on the network other than Hardhat due to: " +
        "1. The initial nonce of the contract deployer must be zero at the beginning of each test. " +
        "2. The ability to change block timestamps for checking the contract under test is required."
      );
    }
    // Resetting the hardhat network to start from scratch and deploy the special token contract mock first
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
    [deployer, attacker, user1, user2] = await ethers.getSigners();
    tokenMock = await deployTokenMock(tokenMock);
    await increaseBlockchainTimeToSpecificRelativeDay(1);
    balanceTrackerFactory = await ethers.getContractFactory("BalanceTracker");
  });

  async function deployAndConfigureContracts(): Promise<{
    balanceTracker: Contract,
    balanceTrackerInitDay: number
  }> {
    const balanceTracker: Contract = await upgrades.deployProxy(balanceTrackerFactory.connect(deployer));
    await balanceTracker.deployed();
    const txReceipt: TransactionReceipt = await balanceTracker.deployTransaction.wait();
    const balanceTrackerInitDay = await getTxDayIndex(txReceipt);
    await proveTx(tokenMock.setBalance(user1.address, INIT_TOKEN_BALANCE));
    await proveTx(tokenMock.setBalance(user2.address, INIT_TOKEN_BALANCE));
    return {
      balanceTracker,
      balanceTrackerInitDay,
    };
  }

  async function initTestContext(): Promise<TestContext> {
    const { balanceTracker, balanceTrackerInitDay } = await setUpFixture(deployAndConfigureContracts);
    const balanceByAddressMap: Map<string, BigNumber> = new Map();
    balanceByAddressMap.set(user1.address, INIT_TOKEN_BALANCE);
    balanceByAddressMap.set(user2.address, INIT_TOKEN_BALANCE);
    const balanceRecordsByAddressMap: Map<string, BalanceRecord[]> = new Map();
    return {
      balanceTracker,
      balanceTrackerInitDay,
      balanceByAddressMap,
      balanceRecordsByAddressMap
    };
  }

  async function executeTokenTransfers(context: TestContext, transfers: TokenTransfer[]) {
    const { balanceTracker } = context;
    let previousTransferDay: number = toDayIndex(await time.latest());
    for (let i = 0; i < transfers.length; ++i) {
      const transfer: TokenTransfer = transfers[i];
      if (transfer.executionDay < previousTransferDay) {
        throw new Error(
          `In the array of token transfers transfer[${i}] has execution day lower than one of the previous transfer`
        );
      }
      const nextRelativeDay = transfer.executionDay - previousTransferDay;
      await increaseBlockchainTimeToSpecificRelativeDay(nextRelativeDay);
      previousTransferDay = transfer.executionDay;

      const tx: TransactionResponse = await tokenMock.simulateHookedTransfer(
        balanceTracker.address,
        transfer.addressFrom,
        transfer.addressTo,
        transfer.amount
      );
      const balanceChanges: BalanceChange[] = toBalanceChanges(transfer);
      const newBalanceRecord1: BalanceRecord | undefined = applyBalanceChange(context, balanceChanges[0]);
      const newBalanceRecord2: BalanceRecord | undefined = applyBalanceChange(context, balanceChanges[1]);

      if (!newBalanceRecord1 && !newBalanceRecord2) {
        await expect(tx).not.to.emit(balanceTracker, "BalanceRecordCreated");
      } else {
        if (!!newBalanceRecord1) {
          await expect(tx).to.emit(balanceTracker, "BalanceRecordCreated").withArgs(
            newBalanceRecord1.accountAddress,
            newBalanceRecord1.day,
            newBalanceRecord1.value
          );
        }
        if (!!newBalanceRecord2) {
          await expect(tx).to.emit(balanceTracker, "BalanceRecordCreated").withArgs(
            newBalanceRecord2.accountAddress,
            newBalanceRecord2.day,
            newBalanceRecord2.value
          );
        }
      }
    }
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { balanceTracker, balanceTrackerInitDay } = await setUpFixture(deployAndConfigureContracts);
      expect(await balanceTracker.NEGATIVE_TIME_SHIFT()).to.equal(NEGATIVE_TIME_SHIFT);
      expect(await balanceTracker.TOKEN()).to.equal(tokenMock.address);
      expect(await balanceTracker.token()).to.equal(tokenMock.address);
      expect(await balanceTracker.INITIALIZATION_DAY()).to.equal(balanceTrackerInitDay);
      expect(await balanceTracker.owner()).to.equal(deployer.address);

      // To check the reading function against the empty balance record array
      await checkBalanceRecordsForAccount(balanceTracker, deployer.address, []);
    });

    it("Is reverted if called for the second time", async () => {
      const { balanceTracker } = await setUpFixture(deployAndConfigureContracts);
      await expect(balanceTracker.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const balanceTrackerImplementation: Contract = await balanceTrackerFactory.deploy();
      await balanceTrackerImplementation.deployed();
      await expect(balanceTrackerImplementation.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });
  });

  describe("Function 'afterTokenTransfer()'", async () => {
    async function checkTokenTransfers(context: TestContext, transfers: TokenTransfer[]) {
      await executeTokenTransfers(context, transfers);
      for (let address: string of context.balanceRecordsByAddressMap.keys()) {
        const expectedBalanceRecords: BalanceRecord[] = context.balanceRecordsByAddressMap.get(address) ?? [];
        await checkBalanceRecordsForAccount(context.balanceTracker, address, expectedBalanceRecords);
      }
    }

    describe("Executes as expected if", async () => {
      describe("A token transfer happens on the next day after the initialization and", async () => {
        describe("The amount of tokens is non-zero and", async () => {
          it("Addresses 'from' and 'to' are both non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: user2.address,
              amount: BigNumber.from(123456789),
            };
            await checkTokenTransfers(context, [transfer]);
          });

          it("Address 'from' is non-zero, address 'to' is zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: ZERO_ADDRESS,
              amount: BigNumber.from(123456789),
            };
            await checkTokenTransfers(context, [transfer]);
          });

          it("Address 'from' is zero, address 'to' is non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: ZERO_ADDRESS,
              addressTo: user2.address,
              amount: BigNumber.from(123456789),
            };
            await checkTokenTransfers(context, [transfer]);
          });
        });

        describe("The amount of tokens is zero and", async () => {
          it("Addresses 'from' and 'to' are both non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: user2.address,
              amount: ZERO_BIG_NUMBER,
            };
            await checkTokenTransfers(context, [transfer]);
          });
        });
      });

      describe("A token transfer happens on the same day as the initialization one and", async () => {
        it("The amount of tokens is non-zero and addresses 'from' and 'to' are both non-zero", async () => {
          const context: TestContext = await initTestContext();
          const transfer: TokenTransfer = {
            executionDay: context.balanceTrackerInitDay,
            addressFrom: user1.address,
            addressTo: user2.address,
            amount: BigNumber.from(123456789),
          };
          await checkTokenTransfers(context, [transfer]);
        });
      });

      describe("Two transfers happen on the next day after the initialization and", async () => {
        it("The amount of tokens is non-zero and addresses 'from' and 'to' are both non-zero", async () => {
          const context: TestContext = await initTestContext();
          const nextDayAfterInit = context.balanceTrackerInitDay + 1;
          const transfer1: TokenTransfer = {
            executionDay: nextDayAfterInit,
            addressFrom: user1.address,
            addressTo: user2.address,
            amount: BigNumber.from(123456789),
          };
          const transfer2: TokenTransfer = {
            executionDay: nextDayAfterInit,
            addressFrom: user2.address,
            addressTo: user1.address,
            amount: BigNumber.from(987654321),
          };
          await checkTokenTransfers(context, [transfer1, transfer2]);
        });
      });
    });

    describe("Is reverted if ", async () => {
      it("Is called not by a token", async () => {
        const context: TestContext = await initTestContext();
        await expect(
          context.balanceTracker.connect(attacker).afterTokenTransfer(user1.address, user2.address, 123)
        ).to.be.revertedWithCustomError(
          context.balanceTracker,
          REVERT_ERROR_UNAUTHORIZED_CALLER
        ).withArgs(attacker.address);
      });

      describe("A token transfer happens not on the initialization day and the amount is non-zero and", async () => {
        it("The initial token balance is greater than 240-bit unsigned value", async () => {
          const context: TestContext = await initTestContext();
          await proveTx(tokenMock.setBalance(
            user1.address,
            BigNumber.from("0x1000000000000000000000000000000000000000000000000000000000000")
          ));

          await increaseBlockchainTimeToSpecificRelativeDay(1);

          await expect(
            tokenMock.simulateHookedTransfer(
              context.balanceTracker.address,
              user1.address,
              user2.address,
              1
            )
          ).to.be.revertedWithCustomError(context.balanceTracker, REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240);
        });

        it("The transfer day index is greater than 65536", async () => {
          const context: TestContext = await initTestContext();

          const currentTimestampInSeconds: number = await time.latest();
          const currentDay = toDayIndex(currentTimestampInSeconds);
          await increaseBlockchainTimeToSpecificRelativeDay(65537 - currentDay);

          await expect(
            tokenMock.simulateHookedTransfer(
              context.balanceTracker.address,
              user1.address,
              user2.address,
              1
            )
          ).to.be.revertedWithCustomError(context.balanceTracker, REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16);
        });
      });
    });
  });

  describe("Function 'beforeTokenTransfer()'", async () => {
    describe("Is reverted if ", async () => {
      it("Is called not by a token", async () => {
        const context: TestContext = await initTestContext();
        await expect(
          context.balanceTracker.connect(attacker).beforeTokenTransfer(user1.address, user2.address, 123)
        ).to.be.revertedWithCustomError(
          context.balanceTracker,
          REVERT_ERROR_UNAUTHORIZED_CALLER
        ).withArgs(attacker.address);
      });
    });
  });

  describe("Function 'getDailyBalances()'", async () => {
    describe("Executes as expected if", async () => {
      async function checkDailyBalances(
        context: TestContext,
        tokenTransfers: TokenTransfer[],
        dayFrom: number,
        dayTo: number
      ) {
        await executeTokenTransfers(context, tokenTransfers);
        const expectedDailyBalancesForUser1: BigNumber[] = defineExpectedDailyBalances(context, {
          address: user1.address,
          dayFrom,
          dayTo
        });
        const expectedDailyBalancesForUser2: BigNumber[] = defineExpectedDailyBalances(context, {
          address: user2.address,
          dayFrom,
          dayTo
        });
        const actualDailyBalancesForUser1: BigNumber[] =
          await context.balanceTracker.getDailyBalances(user1.address, dayFrom, dayTo);
        const actualDailyBalancesForUser2: BigNumber[] =
          await context.balanceTracker.getDailyBalances(user2.address, dayFrom, dayTo);
        expect(expectedDailyBalancesForUser1).to.deep.equal(actualDailyBalancesForUser1);
        expect(expectedDailyBalancesForUser2).to.deep.equal(actualDailyBalancesForUser2);
      }

      function prepareTokenTransfers(context: TestContext, firstTransferDay: number): TokenTransfer[] {
        const transfer1: TokenTransfer = {
          executionDay: firstTransferDay,
          addressFrom: user1.address,
          addressTo: user2.address,
          amount: BigNumber.from(123456789),
        };
        const transfer2: TokenTransfer = {
          executionDay: firstTransferDay + 2,
          addressFrom: user2.address,
          addressTo: user1.address,
          amount: BigNumber.from(987654321),
        };
        const transfer3: TokenTransfer = {
          executionDay: firstTransferDay + 6,
          addressFrom: user1.address,
          addressTo: user2.address,
          amount: BigNumber.from(987654320 / 2),
        };
        return [transfer1, transfer2, transfer3];
      }

      describe("There are several balance records starting from the init day with gaps and", async () => {
        it("The 'from' day equals the init day and the `to` day is after the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day equals the init day and the `to` day is prior the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is after the init day and the `to` day after the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay + 1;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is after the init day and the `to` day is prior the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay + 1;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day and the `to` day are both between records and prior the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = tokenTransfers[tokenTransfers.length - 2].executionDay;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day and the `to` day are both after the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 1);
          const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 3;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });
      });

      describe("There are several balance records starting 2 days after the init day with gaps and", async () => {
        it("The 'from' day equals the init day and the `to` day is after the last record day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context, context.balanceTrackerInitDay + 3);
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });
      });

      describe("There are no balance records", async () => {
        it("The 'from' day equals the init day and the `to` day is three days after the init day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = [];
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = context.balanceTrackerInitDay + 3;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });
      });
    });

    describe("Executes as expected for the service account if", async () => {
      describe("There were no token transfers for the account and ", async () => {
        it("The 'from' day is before the service start day and the `to` day is after it", async () => {
          const context: TestContext = await initTestContext();
          const dayFrom = SERVICE_START_DAY - 1;
          const dayTo = SERVICE_START_DAY + 1;
          const expectedDailyBalances: BigNumber[] = [
            SERVICE_ACCOUNT_SPECIAL_TOKEN_BALANCE,
            SERVICE_ACCOUNT_SPECIAL_TOKEN_BALANCE,
            ZERO_BIG_NUMBER
          ];
          const actualDailyBalances: BigNumber[] =
            await context.balanceTracker.getDailyBalances(SERVICE_ACCOUNT_ADDRESS, dayFrom, dayTo);
          expect(expectedDailyBalances).to.deep.equal(actualDailyBalances);
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The 'from' day is prior the contract init day", async () => {
        const context: TestContext = await initTestContext();
        const dayFrom = context.balanceTrackerInitDay - 1;
        const dayTo = context.balanceTrackerInitDay + 1;
        await expect(
          context.balanceTracker.getDailyBalances(user1.address, dayFrom, dayTo)
        ).to.be.revertedWithCustomError(context.balanceTracker, REVERT_ERROR_FROM_DAY_PRIOR_INIT_DAY);
      });

      it("The 'to' day is prior the 'from' day", async () => {
        const context: TestContext = await initTestContext();
        const dayFrom = context.balanceTrackerInitDay + 2;
        const dayTo = context.balanceTrackerInitDay + 1;
        await expect(
          context.balanceTracker.getDailyBalances(user1.address, dayFrom, dayTo)
        ).to.be.revertedWithCustomError(context.balanceTracker, REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY);
      });
    });
  });

});
