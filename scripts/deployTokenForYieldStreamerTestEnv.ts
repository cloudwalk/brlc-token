import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { Logger } from "../test-utils/logger";

// Script input parameters
const tokenContractName: string = process.env.SP_TOKEN_CONTRACT_NAME ?? "ERC20Harness";
const tokenName: string = process.env.SP_TOKEN_NAME ?? "Yield Streamer Mock Token";
const tokenSymbol: string = process.env.SP_TOKEN_SYMBOL ?? "YSMT";

// Script constants
const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

async function main() {
  logger.log(`🏁 Deploying and configuring a token contract using proxy...`);
  const [deployer] = await ethers.getSigners();
  logger.increaseLogIndent();
  logger.log("👉 The deployer (owner) address:", deployer.address);
  logger.log("👉 The token contract name:", tokenContractName);
  logger.logEmptyLine();

  const tokenContractFactory: ContractFactory = await ethers.getContractFactory(tokenContractName);
  const tokenContractArguments = [tokenName, tokenSymbol];
  const tokenContract: Contract = await upgrades.deployProxy(tokenContractFactory, tokenContractArguments);
  await tokenContract.deployed();
  logger.log(
    `✅ The token contract has been deployed successfully. ` +
    `The proxy address: ${tokenContract.address} . The tx hash: ${tokenContract.deployTransaction.hash}`
  );
  logger.logEmptyLine();

  logger.decreaseLogIndent();
  logger.log("🎉 Everything is done");
}

main().then().catch(err => {
  throw err;
});