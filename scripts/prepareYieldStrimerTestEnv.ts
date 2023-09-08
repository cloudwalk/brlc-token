import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { proveTx } from "../test-utils/eth";
import { Logger } from "../test-utils/logger";

// Script input parameters
const tokenContractAddress: string = process.env.SP_TOKEN_CONTRACT_ADDRESS ?? "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const balanceTrackerContractName: string = process.env.SP_BALANCE_TRACKER_CONTRACT_NAME ?? "BalanceTrackerHarness";
const yieldStreamerContractName: string = process.env.SP_YIELD_STREAMER_CONTRACT_NAME ?? "YieldStreamerHarness";
const taxReceiverAddress: string = process.env.SP_TAX_RECEIVER_ADDRESS ?? "0xeeeaaa0000000000000000000000000000000001";
const yieldRateInPpm: number = parseInt(process.env.SP_YIELD_RATE_IN_PPM ?? "101"); // 0.01% per day
const lookBackPeriodInDays: number = parseInt(process.env.SP_LOOK_BACK_PERIOD_IN_DAYS ?? "4");

// Script constants
const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

async function deployContractUsingProxy(contractName: string) {
  logger.log(`🏁 Deploying contract '${contractName}' using proxy...`);
  const contractFactory: ContractFactory = await ethers.getContractFactory(contractName);
  const contract: Contract = await upgrades.deployProxy(contractFactory);
  await contract.deployed();
  logger.log(
    `✅ The contract has been deployed successfully. ` +
    `The proxy address: ${contract.address} . The tx hash: ${contract.deployTransaction.hash}`
  );
  logger.logEmptyLine();
  return contract;
}

async function main() {
  logger.log(`🏁 Deploying and configuring contracts...`);
  const [deployer] = await ethers.getSigners();
  logger.increaseLogIndent();
  logger.log("👉 The deployer (owner) address:", deployer.address);
  logger.log("👉 The balance tracker contract name:", balanceTrackerContractName);
  logger.log("👉 The yield streamer contract name:", yieldStreamerContractName);
  logger.log("👉 The tax receiver address:", taxReceiverAddress);
  logger.log("👉 The yield rate in PPM:", yieldRateInPpm);
  logger.log("👉 The look-back period in days:", lookBackPeriodInDays);
  logger.logEmptyLine();

  const balanceTrackerContract: Contract = await deployContractUsingProxy(balanceTrackerContractName);
  const yieldStreamerContract: Contract = await deployContractUsingProxy(yieldStreamerContractName);

  logger.log(`🏁 Configuring the yield streamer contract ...`);
  logger.increaseLogIndent();

  logger.log(`▶ Configuring the tax receiver ...`);
  await proveTx(yieldStreamerContract.setTaxReceiver(taxReceiverAddress));
  logger.log(`✅ It has been configured successfully`);
  logger.logEmptyLine();

  logger.log(`▶ Configuring the balance tracker address ...`);
  await proveTx(yieldStreamerContract.setBalanceTracker(balanceTrackerContract.address));
  logger.log(`✅ It has been configured successfully`);
  logger.logEmptyLine();

  logger.log(`▶ Configuring the look-back period ...`);
  await proveTx(yieldStreamerContract.configureLookBackPeriod(lookBackPeriodInDays - 1, lookBackPeriodInDays));
  logger.log(`✅ It has been configured successfully`);
  logger.logEmptyLine();

  logger.log(`▶ Configuring the yield rate ...`);
  await proveTx(yieldStreamerContract.configureYieldRate(0, yieldRateInPpm));
  logger.log(`✅ It has been configured successfully`);
  logger.logEmptyLine();

  logger.decreaseLogIndent();

  logger.log(`🏁 Checking the balance tracker contract ...`);
  const actualTokenAddress = await balanceTrackerContract.token();
  if (actualTokenAddress !== tokenContractAddress) {
    logger.log(`⚠️ WARNING! The wrong token address in the balance tracker contract. ` +
      `Expected: ${tokenContractAddress}. Actual: ${actualTokenAddress}. ` +
      `Please update the balance tracker implementation using the correct token address`
    );
  } else {
    logger.log(`✅ Everything looks good`);
  }
  logger.logEmptyLine();

  logger.decreaseLogIndent();
  logger.log("🎉 Everything is done");
}

main().then().catch(err => {
  throw err;
});