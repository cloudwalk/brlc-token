import { ethers } from "hardhat";
import { ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";

// Script input parameters
const contractName: string = process.env.SP_CONTRACT_NAME ?? "YieldStreamerHarness"; //"BalanceTrackerHarness";
const errorData: string = process.env.SP_ERROR_DATA ?? "0x78796bb100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000046546865206066726f6d6020646179206d7573742062652067726561746572207468616e206f7220657175616c20746f2074686520696e697469616c697a6174696f6e206461790000000000000000000000000000000000000000000000000000";

// Script constants
const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

async function main() {
  logger.log(`🏁 Decoding error...`);
  logger.increaseLogIndent();
  logger.log("👉 The contract name:", contractName);
  logger.log("👉 The error data:", errorData);
  logger.logEmptyLine();

  const contractFactory: ContractFactory = await ethers.getContractFactory(contractName);
  const result = contractFactory.interface.parseError(errorData);
  logger.log(`✅ The error has been decoded successfully: `, result);
  logger.logEmptyLine();

  logger.decreaseLogIndent();
  logger.log("🎉 Everything is done");
}

main().then().catch(err => {
  throw err;
});