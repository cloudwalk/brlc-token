import { ethers } from "hardhat";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";

// Script input parameters
const yieldStreamerContractName: string = process.env.SP_YIELD_STREAMER_CONTRACT_NAME ?? "YieldStreamerHarness";
const yieldStreamerContractAddress: string = process.env.SP_YIELD_STREAMER_CONTRACT_ADDRESS ?? "0x2B7967A8Edd47c4F073900ddfABC994ec8071bfc";
const accountAddress: string = process.env.SP_ACCOUNT_ADDRESS ?? "0x0DA7D8663d3e00cA06858a2A76C2B6B271733e83";
const predictionPeriodInSeconds: number = parseInt(process.env.SP_PREDICTION_PERIOD_IN_SECONDS ?? "10");

// Script constants
const SECONDS_IN_DAY = 24 * 3600;
const TIME_SHIFT_IN_SECONDS = -3 * 3600;
const PROHIBITED_DAY_PART_IN_SECONDS = 60;

const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

interface ClaimResult {
  nextClaimDay: BigNumber;
  nextClaimDebit: BigNumber;
  primaryYield: BigNumber;
  streamYield: BigNumber;
  shortfall: BigNumber;
  tax: BigNumber;
}

interface DayAndTime {
  dayIndex: number,
  dayTimeInSeconds: number;
}

interface CalcYield {
  primaryYield: number;
  streamYield: number;
}

interface Result {
  predictedPrimaryYield: number;
  requestedPrimaryYield: number;
  predictedStreamYield: number;
  requestedStreamYield: number;
  predictedDayIndex: number;
  requestedDayIndex: number;
  predictedDayTimeInSeconds: number;
  requestedDayTimeInSeconds: number;
}

async function main() {
  logger.log(`🏁 Predicting and comparing the yield values ...`);
  logger.increaseLogIndent();
  logger.log("👉 The yield streamer contract name:", yieldStreamerContractName);
  logger.log("👉 The yield streamer contract address:", yieldStreamerContractAddress);
  logger.log("👉 The account address:", accountAddress);
  logger.log("👉 The predicting period in seconds:", predictionPeriodInSeconds);
  logger.logEmptyLine();

  logger.log("▶ Fetching needed init data for the predicting from the blockchain ...");

  const yieldStreamerFactory: ContractFactory = await ethers.getContractFactory(yieldStreamerContractName);
  const yieldStreamer: Contract = yieldStreamerFactory.attach(yieldStreamerContractAddress);

  const dayAndTime: DayAndTime = getCurrentDayAndTime();
  checkDayAndTime(dayAndTime);
  const yesterday: number = dayAndTime.dayIndex - 1;

  const zeroAmountClaimResult: ClaimResult = await yieldStreamer.claimPreview(accountAddress, 0);
  const fistYieldDay: number = zeroAmountClaimResult.nextClaimDay.toNumber();
  const prevClaimDebit: BigNumber = zeroAmountClaimResult.nextClaimDebit;
  const yieldByDaysReadOnly: BigNumber[] = (await yieldStreamer.calculateYieldByDays(
    accountAddress,
    fistYieldDay,
    yesterday
  ));
  const yieldByDays: BigNumber[] = [...yieldByDaysReadOnly];
  correctFirstDayYield(yieldByDays, prevClaimDebit);

  logger.log("✅ Done");
  logger.logEmptyLine();

  logger.log(`▶ Making a new yield preview result every ${predictionPeriodInSeconds} s. Terminate the process to stop ...`);
  let lastCalculationTimestamp = 0;
  let calculationCounter = 0;
  while (1) {
    const pauseBeforeNewCalculation = lastCalculationTimestamp + predictionPeriodInSeconds * 1000 - Date.now();
    if (pauseBeforeNewCalculation > 0) {
      await wait(pauseBeforeNewCalculation);
    }
    lastCalculationTimestamp = Date.now();
    const dayAndTime: DayAndTime = getCurrentDayAndTime();
    checkDayAndTime(dayAndTime);
    const calcYield: CalcYield = calculateYield(yieldByDays, dayAndTime, fistYieldDay, prevClaimDebit);
    const requestedClaimResult: ClaimResult = await yieldStreamer.claimAllPreview(accountAddress);
    const requestedDayAndTime: BigNumber[] = await yieldStreamer.dayAndTime();
    const result: Result = {
      predictedPrimaryYield: calcYield.primaryYield,
      requestedPrimaryYield: requestedClaimResult.primaryYield.toNumber(),
      predictedStreamYield: calcYield.streamYield,
      requestedStreamYield: requestedClaimResult.streamYield.toNumber(),
      predictedDayIndex: dayAndTime.dayIndex,
      requestedDayIndex: requestedDayAndTime[0].toNumber(),
      predictedDayTimeInSeconds: dayAndTime.dayTimeInSeconds,
      requestedDayTimeInSeconds: requestedDayAndTime[1].toNumber(),
    };
    ++calculationCounter;
    logger.log(`👉 Yield preview result ${calculationCounter}:`, result);
  }
}

function getCurrentDayAndTime(): DayAndTime {
  const timestampInSeconds: number = Date.now() / 1000;
  const shiftedTimestampInSeconds = timestampInSeconds + TIME_SHIFT_IN_SECONDS;
  const dayIndex: number = Math.floor(shiftedTimestampInSeconds / SECONDS_IN_DAY);
  const dayTimeInSeconds: number = Math.floor(shiftedTimestampInSeconds - dayIndex * SECONDS_IN_DAY);
  return {
    dayIndex,
    dayTimeInSeconds
  };
}

function checkDayAndTime(dayAndTime: DayAndTime) {
  if (dayAndTime.dayTimeInSeconds > SECONDS_IN_DAY - PROHIBITED_DAY_PART_IN_SECONDS) {
    throw new Error(
      `The current Brazil time is too close to the day end: ${dayAndTime.dayTimeInSeconds} / ${SECONDS_IN_DAY} s. ` +
      ` Please try to run the script later`
    );
  }
  if (dayAndTime.dayTimeInSeconds < PROHIBITED_DAY_PART_IN_SECONDS) {
    throw new Error(
      `The current Brazil time is too close to the day start: ${dayAndTime.dayTimeInSeconds} / ${SECONDS_IN_DAY} s. ` +
      `Please try to run the script later`
    );
  }
}

function correctFirstDayYield(yieldByDays: BigNumber[], prevClaimDebit: BigNumber) {
  if (yieldByDays.length <= 1) {
    return;
  }
  if (yieldByDays[0].lt(prevClaimDebit)) {
    yieldByDays[0] = BigNumber.from(0);
  } else {
    yieldByDays[0] = yieldByDays[0].sub(prevClaimDebit);
  }
}

function calculateYield(
  yieldByDays: BigNumber[],
  currentDayAndTime: DayAndTime,
  firstYieldDay: number,
  prevClaimDebit: BigNumber
): CalcYield {
  const len = yieldByDays.length;
  const result: CalcYield = {
    primaryYield: 0,
    streamYield: 0,
  };
  if (len === 0) {
    return result;
  }

  const lastDayYield: number = yieldByDays[len - 1].toNumber();
  for (let i = 0; i < (len - 1); ++i) {
    result.primaryYield += yieldByDays[i].toNumber();
  }
  result.streamYield = Math.floor(lastDayYield * currentDayAndTime.dayTimeInSeconds / SECONDS_IN_DAY);

  if (firstYieldDay == currentDayAndTime.dayIndex - 1) {
    result.streamYield -= prevClaimDebit.toNumber();
    if (result.streamYield < 0) {
      result.streamYield = 0;
    }
  }

  return result;
}

async function wait(timeoutInMills: number) {
  await new Promise((resolve) => setTimeout(resolve, timeoutInMills));
}

main().then().catch(err => {
  throw err;
});
