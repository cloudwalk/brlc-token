import { ethers } from "hardhat";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";

// Script input parameters
const yieldStreamerContractName: string = process.env.SP_YIELD_STREAMER_CONTRACT_NAME ?? "YieldStreamerHarness";
const yieldStreamerContractAddress: string = process.env.SP_YIELD_STREAMER_CONTRACT_ADDRESS ?? "0x2B7967A8Edd47c4F073900ddfABC994ec8071bfc";
const accountAddress: string = process.env.SP_ACCOUNT_ADDRESS ?? "0x0DA7D8663d3e00cA06858a2A76C2B6B271733e83";
const predictionPeriodInSeconds: number = parseInt(process.env.SP_PREDICTION_PERIOD_IN_SECONDS ?? "10");

// Script constants
const BIG_NUMBER_ZERO = ethers.constants.Zero;
const SECONDS_IN_DAY = 24 * 3600;
const TIME_SHIFT_IN_SECONDS = -3 * 3600;
const PROHIBITED_DAY_PART_IN_SECONDS = 60;

const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

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

interface DayAndTime {
  dayIndex: number,
  dayTimeInSeconds: number;
}

interface CalcYield {
  primaryYield: BigNumber;
  streamYield: BigNumber;
}

interface Result {
  predictedPrimaryYield: string;
  requestedPrimaryYield: string;
  predictedStreamYield: string;
  requestedStreamYield: string;
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

  const initClaimResult: ClaimResult = await yieldStreamer.claimAllPreview(accountAddress);

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
    const calcYield: CalcYield = calculateYield(initClaimResult, dayAndTime);
    const requestedClaimResult: ClaimResult = await yieldStreamer.claimAllPreview(accountAddress);
    const requestedDayAndTime: BigNumber[] = await yieldStreamer.dayAndTime();
    const result: Result = {
      predictedPrimaryYield: calcYield.primaryYield.toString(),
      requestedPrimaryYield: requestedClaimResult.primaryYield.toString(),
      predictedStreamYield: calcYield.streamYield.toString(),
      requestedStreamYield: requestedClaimResult.streamYield.toString(),
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


function calculateYield(
  initClaimResult: ClaimResult,
  currentDayAndTime: DayAndTime,
): CalcYield {
  const result: CalcYield = {
    primaryYield: initClaimResult.primaryYield,
    streamYield: initClaimResult.lastDayYield.mul(currentDayAndTime.dayTimeInSeconds).div(SECONDS_IN_DAY),
  };

  if (initClaimResult.firstYieldDay.toNumber() == currentDayAndTime.dayIndex - 1) {
    result.streamYield = result.streamYield.sub(initClaimResult.prevClaimDebit);
    if (result.streamYield < 0) {
      result.streamYield = BIG_NUMBER_ZERO;
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
