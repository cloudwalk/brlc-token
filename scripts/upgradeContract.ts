import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";

// Script input parameters
const contractName: string = process.env.SP_CONTRACT_NAME ?? "BalanceTrackerHarness"; //"BalanceTrackerHarness";
const contractAddress: string = process.env.SP_CONTRACT_ADDRESS ?? "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";//"0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";

// Script constants
const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

async function main() {
  logger.log(`🏁 Upgrading a contract using proxy...`);
  const [deployer] = await ethers.getSigners();
  logger.increaseLogIndent();
  logger.log("👉 The deployer (owner) address:", deployer.address);
  logger.log("👉 The contract name:", contractName);
  logger.log("👉 The contract address:", contractAddress);
  logger.logEmptyLine();

  const contractFactory: ContractFactory = await ethers.getContractFactory(contractName);
  const contract: Contract = await upgrades.upgradeProxy(contractAddress, contractFactory);
  await contract.deployed();
  logger.log(`✅ The contract has been upgraded successfully`);
  logger.logEmptyLine();

  logger.decreaseLogIndent();
  logger.log("🎉 Everything is done");
}

main().then().catch(err => {
  throw err;
});