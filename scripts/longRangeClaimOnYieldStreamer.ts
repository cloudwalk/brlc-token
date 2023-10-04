import { ethers } from "hardhat";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../test-utils/eth";

// Script input parameters
const tokenContractName: string = process.env.SP_TOKEN_CONTRACT_NAME ?? "ERC20Harness";
const balanceTrackerContractName: string = process.env.SP_BALANCE_TRACKER_CONTRACT_NAME ?? "BalanceTrackerHarness";
const yieldStreamerContractName: string = process.env.SP_YIELD_STREAMER_CONTRACT_NAME ?? "YieldStreamerHarness";
const yieldStreamerContractAddress: string = process.env.SP_YIELD_STREAMER_CONTRACT_ADDRESS ?? "0x7577878638443C1D2CF6bdCDe43CD60e8c22Ac85";
const yieldRateInPpm: number = parseInt(process.env.SP_YIELD_RATE_IN_PPM ?? "100"); // 0.01% per day
const lookBackPeriodInDays: number = parseInt(process.env.SP_LOOK_BACK_PERIOD_IN_DAYS ?? "30");
const userCurrentBalance: number = parseInt(process.env.SP_USER_CURRENT_BALANCE ?? "1000000000");
const yieldStreamerStartBalance: number = parseInt(process.env.SP_YIELD_STREAMER_START_BALANCE ?? "1000000000");
const trackerInitializationDay: number = parseInt(process.env.SP_TRACKER_INITIALIZATION_DAY ?? "100");
const yieldRangeInDays: number = parseInt(process.env.SP_YIELD_RANGE_IN_DAYS ?? "1000");

// Script constants
const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

const NEGATIVE_TIME_SHIFT = 3 * 60 * 60;

interface BalanceRecord {
  day: number;
  value: BigNumber;
}

interface ClaimState {
  day: number;
  debit: BigNumber;
}

interface LookBackPeriod {
  effectiveDay: number;
  length: number;
}

interface YieldRate {
  effectiveDay: number;
  value: BigNumber;
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


interface Context {
  yieldStreamerContract: Contract;
  balanceTrackerContract: Contract;
  tokenContract: Contract;
  feeReceiverAddress: string;
  initYieldRates: YieldRate[];
  initLookBackPeriods: LookBackPeriod[];
  initTokenTotalSupply: BigNumber;
  initYieldStreamerBalance: BigNumber;
  initUserBalance: BigNumber;
  initTrackerInitializationDay: number;
  owner: SignerWithAddress;
  user: SignerWithAddress;
  usingRealBlockTimestamps: boolean;
}

async function main() {
  logger.log(`🏁 Making a long claim test of the YieldStreamer contract...`);
  const [owner, user] = await ethers.getSigners();
  logger.increaseLogIndent();
  await showInputParameters(owner, user);

  logger.log(`▶ Getting the initial settings of the contracts ...`);
  const context: Context = await defineInitContext(owner, user);
  showInitialSettings(context);
  logger.log(`✅ Done`);
  logger.logEmptyLine();

  if (
    context.initYieldRates.length !== 1 ||
    context.initYieldRates[0].effectiveDay !== 0 ||
    context.initYieldRates[0].value.toString() !== yieldRateInPpm.toString()
  ) {
    await configureYieldRate(
      context,
      { effectiveDay: 0, value: BigNumber.from(yieldRateInPpm) }
    );
  }

  const lookBackPeriodEffectiveDay = trackerInitializationDay + lookBackPeriodInDays - 1;
  if (
    context.initLookBackPeriods.length !== 1 ||
    context.initLookBackPeriods[0].effectiveDay !== lookBackPeriodEffectiveDay ||
    context.initLookBackPeriods[0].length !== lookBackPeriodInDays
  ) {
    await configureLookBackPeriod(context, { effectiveDay: lookBackPeriodEffectiveDay, length: lookBackPeriodInDays });
  }

  if (context.initYieldStreamerBalance.toString() !== yieldStreamerStartBalance.toString()) {
    await configureBalance(
      context,
      "YieldStreamer",
      context.yieldStreamerContract.address,
      BigNumber.from(yieldStreamerStartBalance)
    );
  }

  if (context.initUserBalance.toString() !== userCurrentBalance.toString()) {
    await configureBalance(
      context,
      "User",
      user.address,
      BigNumber.from(userCurrentBalance)
    );
  }

  if (context.initTrackerInitializationDay !== trackerInitializationDay) {
    await configureTrackerInitializationDay(context, trackerInitializationDay);
  }

  // Reset the claim state for the user
  await proveTx(context.yieldStreamerContract.resetClaimState(user.address));

  // Let's consider the following balance records
  const expectedBalanceRecords: BalanceRecord[] = [
    { day: trackerInitializationDay, value: BigNumber.from(userCurrentBalance) },
  ];

  const actualBalanceRecords: BalanceRecord[] = await getBalanceRecords(context.balanceTrackerContract, user.address);
  if (!compareBalanceRecords(actualBalanceRecords, expectedBalanceRecords)) {
    await configureBalanceRecords(context, expectedBalanceRecords);
  }

  /*****************************************************************************
   * Case 1
   ****************************************************************************/

  logger.log(`🏁 Starting case 1 ...`);
  logger.increaseLogIndent();

  // Let's consider the following day and time for claiming
  const claimDay1 = lookBackPeriodEffectiveDay + yieldRangeInDays + 1;
  const claimTime1 = NEGATIVE_TIME_SHIFT;
  await configureCurrentBlockTimestamp(context, claimDay1, claimTime1);

  logger.log(`▶ Checking the 'claimAllPreview()' function result for case 1 ...`);
  const actualClaimPreviewResult1: ClaimResult = await context.yieldStreamerContract.claimAllPreview(user.address);
  logger.log(`✅ The claim preview result: `, actualClaimPreviewResult1);
  logger.logEmptyLine();

  logger.log(`▶ Executing the 'claimAll()' function for case 1 ...`);
  const tx1 = await proveTx(context.yieldStreamerContract.connect(user).claimAll());
  logger.log(`✅ The function executes as expected. Tx hash: ${tx1.transactionHash}. Tx gas used: ${tx1.gasUsed}`);
  logger.logEmptyLine();

  logger.log(`▶ Checking the claim state after the 'claimAll()' function for case 1 ...`);
  const actualClaimState1: ClaimState = await context.yieldStreamerContract.getLastClaimDetails(user.address);
  logger.log(`✅ The state has gotten:`, actualClaimState1);
  logger.logEmptyLine();

  logger.decreaseLogIndent();
  logger.log(`✅ Case 1 has been finished successfully`);
  logger.logEmptyLine();
  logger.logEmptyLine();

  logger.log("🎉 Everything is done");
}

main().then().catch(err => {
  throw err;
});

async function showInputParameters(owner: SignerWithAddress, user: SignerWithAddress) {
  logger.log("👉 The owner address:", owner.address);
  logger.log("👉 The user address:", user.address);
  logger.log("👉 The token contract name:", balanceTrackerContractName);
  logger.log("👉 The balance tracker contract name:", balanceTrackerContractName);
  logger.log("👉 The yield streamer contract name:", yieldStreamerContractName);
  logger.log("👉 The yield streamer contract address:", yieldStreamerContractAddress);
  logger.log("👉 The user address:", user.address);
  logger.log("👉 The yield rate in PPM:", yieldRateInPpm);
  logger.log("👉 The look-back period in days:", lookBackPeriodInDays);
  logger.log("👉 The target yield range in days :", yieldRangeInDays);
  logger.logEmptyLine();
}

async function defineInitContext(owner: SignerWithAddress, user: SignerWithAddress): Promise<Context> {
  const yieldStreamerContract: Contract = await attachContract(yieldStreamerContractName, yieldStreamerContractAddress);
  const balanceTrackerAddress: string = await yieldStreamerContract.balanceTracker();
  const feeReceiverAddress: string = await yieldStreamerContract.feeReceiver();
  const balanceTrackerContract: Contract = await attachContract(balanceTrackerContractName, balanceTrackerAddress);
  const tokenAddress: string = await balanceTrackerContract.token();
  const tokenContract: Contract = await attachContract(tokenContractName, tokenAddress);
  const initYieldRates: YieldRate[] = await getYieldRates(yieldStreamerContract);
  const initLookBackPeriods: LookBackPeriod[] = await getLookBackPeriods(yieldStreamerContract);
  const initTokenTotalSupply: BigNumber = await tokenContract.totalSupply();
  const initUserBalance: BigNumber = await tokenContract.balanceOf(user.address);
  const initYieldStreamerBalance: BigNumber = await tokenContract.balanceOf(yieldStreamerContract.address);
  const initTrackerStartDay: number = await balanceTrackerContract.INITIALIZATION_DAY();
  const usingRealBlockTimestamps: boolean = await balanceTrackerContract.usingRealBlockTimestamps();

  return {
    yieldStreamerContract,
    balanceTrackerContract,
    tokenContract,
    feeReceiverAddress,
    initYieldRates,
    initLookBackPeriods,
    initTokenTotalSupply,
    initYieldStreamerBalance,
    initUserBalance,
    initTrackerInitializationDay: initTrackerStartDay,
    owner,
    user,
    usingRealBlockTimestamps
  };
}

async function attachContract(contractName: string, contractAddress: string): Promise<Contract> {
  const contractFactory: ContractFactory = await ethers.getContractFactory(contractName);
  return contractFactory.attach(contractAddress);
}

async function getYieldRates(contract: Contract): Promise<YieldRate[]> {
  logger.log(`▶ Getting yield rate array ...`);
  logger.increaseLogIndent();

  let yieldRates: YieldRate[] = [];
  let yieldRateArrayLength = 0;
  try {
    const data = await contract.getYieldRate(0);
    yieldRates.push({ effectiveDay: data[0].effectiveDay, value: data[0].value });
    yieldRateArrayLength = BigNumber.from(data[1]).toNumber();
  } catch (e) {
    logger.log(`⚠️ WARNING! Cannot get the first yield rate structure. It might not exist. The exception: ${e}`);
  }

  for (let i = 1; i < yieldRateArrayLength; ++i) {
    try {
      const data = await contract.getYieldRate(i);
      yieldRates.push({ effectiveDay: data[0].effectiveDay, value: data[0].value });
    } catch (e) {
      logger.log(`⚠️ WARNING! Cannot get the yield rate structure with index: ${i}. The exception: ${e}`);
    }
  }
  logger.decreaseLogIndent();
  logger.log(`✅ Done`);
  logger.logEmptyLine();

  return yieldRates;
}

async function getLookBackPeriods(contract: Contract): Promise<LookBackPeriod[]> {
  logger.log(`▶ Getting look-back period array ...`);
  logger.increaseLogIndent();

  let lookBackPeriods: LookBackPeriod[] = [];
  let lookBackArrayLength = 0;
  try {
    const data = await contract.getLookBackPeriod(0);
    lookBackPeriods.push({ effectiveDay: data[0].effectiveDay, length: data[0]._length });
    lookBackArrayLength = BigNumber.from(data[1]).toNumber();
  } catch (e) {
    logger.log(`⚠️ WARNING! Cannot get the first look-back period structure. It might not exist. The exception: ${e}`);
  }

  for (let i = 1; i < lookBackArrayLength; ++i) {
    try {
      const data = await contract.getLookBackPeriod(i);
      lookBackPeriods.push({ effectiveDay: data[0].effectiveDay, length: data[0]._length });
    } catch (e) {
      logger.log(`⚠️ WARNING! Cannot get the look-back period structure with index: ${i}. The exception: ${e}`);
    }
  }
  logger.decreaseLogIndent();
  logger.log(`✅ Done`);
  logger.logEmptyLine();

  return lookBackPeriods;
}

function showInitialSettings(context: Context) {
  logger.increaseLogIndent();
  logger.log("👉 The balance tracker contract address:", context.tokenContract.address);
  logger.log("👉 The token contract address:", context.balanceTrackerContract.address);
  logger.log("👉 The configured initial yield rates:", context.initYieldRates);
  logger.log("👉 The configured initial look-back periods:", context.initLookBackPeriods);
  logger.log("👉 The initial token total supply:", context.initTokenTotalSupply.toString());
  logger.log("👉 The initial YieldStreamer balance:", context.initYieldStreamerBalance.toString());
  logger.log("👉 The initial user current balance:", context.initUserBalance.toString());
  logger.log("👉 The initial tracker balance initialization day:", context.initTrackerInitializationDay);
  logger.decreaseLogIndent();
}

async function configureYieldRate(context: Context, newYieldRate: YieldRate) {
  logger.log(`▶ Configuring a new yield rate ...`);
  logger.increaseLogIndent();
  logger.log("👉 The effective day:", newYieldRate.effectiveDay);
  logger.log("👉 The new value:", newYieldRate.value.toString());

  logger.log(`▶ Deleting the existing yield rate array ...`);
  await proveTx(context.yieldStreamerContract.deleteYieldRates());
  logger.log(`✅ Done`);

  logger.log(`▶ Adding new yield rate to the array ...`);
  await proveTx(context.yieldStreamerContract.configureYieldRate(newYieldRate.effectiveDay, newYieldRate.value));
  logger.log(`✅ Done`);

  logger.decreaseLogIndent();
  logger.log(`✅ The configuration is done`);
  logger.logEmptyLine();
}

async function configureLookBackPeriod(context: Context, newLookBackPeriod: LookBackPeriod) {
  logger.log(`▶ Configuring a new look-back period ...`);
  logger.increaseLogIndent();
  logger.log("👉 The effective day:", newLookBackPeriod.effectiveDay);
  logger.log("👉 The new value:", newLookBackPeriod.length);

  logger.log(`▶ Deleting the existing look-back period array ...`);
  await proveTx(context.yieldStreamerContract.deleteLookBackPeriods());
  logger.log(`✅ Done`);

  logger.log(`▶ Adding new look-back period to the array ...`);
  await proveTx(
    context.yieldStreamerContract.configureLookBackPeriod(newLookBackPeriod.effectiveDay, newLookBackPeriod.length)
  );
  logger.log(`✅ Done`);

  logger.decreaseLogIndent();
  logger.log(`✅ The configuration is done`);
  logger.logEmptyLine();
}

async function configureBalance(
  context: Context,
  accountName: string,
  accountAddress: string,
  balance: BigNumber
) {
  logger.log(`▶ Configuring the initial balance for ${accountName} ...`);
  logger.increaseLogIndent();
  logger.log("👉 The account/contract address:", accountAddress);
  logger.log("👉 The expecting balance:", balance.toString());

  logger.log(`▶ Burning the existing balance ...`);
  await proveTx(context.tokenContract.burnAll(accountAddress));
  logger.log(`✅ Done`);

  logger.log(`▶ Minting tokens ...`);
  await proveTx(context.tokenContract.mint(accountAddress, balance));
  logger.log(`✅ Done`);

  logger.decreaseLogIndent();
  logger.log(`✅ The configuration is done`);
  logger.logEmptyLine();
}

async function configureTrackerInitializationDay(context: Context, newInitializationDay: number) {
  logger.log(`▶ Configuring the initialization day of the balance tracker ...`);
  logger.increaseLogIndent();
  logger.log("👉 The new initialization day:", newInitializationDay);
  logger.decreaseLogIndent();

  await proveTx(context.balanceTrackerContract.setInitializationDay(newInitializationDay));
  logger.log(`✅ The configuration is done`);
  logger.logEmptyLine();
}

async function getBalanceRecords(contract: Contract, accountAddress: string): Promise<BalanceRecord[]> {
  logger.log(`▶ Getting balance record array ...`);
  logger.increaseLogIndent();

  let balanceRecords: BalanceRecord[] = [];
  let balanceRecordArrayLength = 0;
  try {
    const data = await contract.readBalanceRecord(accountAddress, 0);
    balanceRecords.push({ day: data[0].day, value: data[0].value });
    balanceRecordArrayLength = BigNumber.from(data[1]).toNumber();
  } catch (e) {
    logger.log(`⚠️ WARNING! Cannot get the first balance record structure. It might not exist. The exception: ${e}`);
  }

  for (let i = 1; i < balanceRecordArrayLength; ++i) {
    try {
      const data = await contract.readBalanceRecord(accountAddress, i);
      balanceRecords.push({ day: data[0].day, value: data[0].value });
    } catch (e) {
      logger.log(`⚠️ WARNING! Cannot get the balance record structure with index: ${i}. The exception: ${e}`);
    }
  }

  logger.decreaseLogIndent();
  logger.log(`✅ Done`);
  logger.logEmptyLine();

  return balanceRecords;
}

function compareBalanceRecords(actualBalanceRecords: BalanceRecord[], expectedBalanceRecords: BalanceRecord[]) {
  if (actualBalanceRecords.length !== expectedBalanceRecords.length) {
    return false;
  }
  for (let i = 0; i < expectedBalanceRecords.length; ++i) {
    const actualBalanceRecord: BalanceRecord = actualBalanceRecords[i];
    const expectedBalanceRecord: BalanceRecord = expectedBalanceRecords[i];
    if (actualBalanceRecord.day !== expectedBalanceRecord.day) {
      return false;
    }
    if (actualBalanceRecord.value.toString() !== expectedBalanceRecord.value.toString()) {
      return false;
    }
  }
  return true;
}

async function configureBalanceRecords(context: Context, newBalanceRecords: BalanceRecord[]) {
  logger.log(`▶ Configuring balance records of the balance tracker ...`);
  logger.increaseLogIndent();
  logger.log("👉 The count of new records:", newBalanceRecords.length);

  logger.log(`▶ Deleting the existing balance records ...`);
  await proveTx(context.balanceTrackerContract.deleteBalanceRecords(context.user.address));
  logger.log(`✅ Done`);

  for (let i = 0; i < newBalanceRecords.length; ++i) {
    const record: BalanceRecord = newBalanceRecords[i];
    logger.log(`▶ Adding record[${i}] = {day: ${record.day}, value: ${record.value.toString()}} ...`);
    await proveTx(context.balanceTrackerContract.addBalanceRecord(context.user.address, record.day, record.value));
    logger.log(`✅ Done`);
  }

  logger.decreaseLogIndent();
  logger.log(`✅ The configuration is done`);
  logger.logEmptyLine();
}

async function configureCurrentBlockTimestamp(context: Context, newDay: number, newTime: number) {
  logger.log(`▶ Configuring the current block timestamp ...`);
  logger.increaseLogIndent();
  logger.log("👉 The new day:", newDay);
  logger.log("👉 The new time of the day:", newTime);
  logger.decreaseLogIndent();

  await proveTx(context.balanceTrackerContract.setBlockTimestamp(newDay, newTime));
  const blockTimestamp = await context.balanceTrackerContract.currentBlockTimestamp();
  logger.log(`✅ The configuration is done. Block timestamp:`, blockTimestamp);
  logger.logEmptyLine();
}
