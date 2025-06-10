import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { proveTx } from "../test-utils/eth";
import { expect } from "chai";

// Script input parameters
const CONTRACT_NAME: string = process.env.SP_CONTRACT_NAME ?? "BRLCToken";
const PROXY_ADDRESS: string = process.env.SP_PROXY_ADDRESS ?? ""; // TBD: Enter proxy address
const CHAIN_ID: number = parseInt(process.env.SP_CHAIN_ID ?? ""); // TBD: Enter chain ID

class Logger {
  logSingleLevelIndent: string;
  logIndent: string;
  logEnabled: boolean;
  readonly startTime: Date;
  readonly startTimeFormatted: string;

  constructor(logSingleLevelIndent: string) {
    this.logSingleLevelIndent = logSingleLevelIndent;
    this.logIndent = "";
    this.logEnabled = true;
    this.startTime = new Date(Date.now());
    this.startTimeFormatted = Logger.formatDate(this.startTime);
  }

  increaseLogIndent(numberOfSteps: number = 1) {
    this.logIndent += this.logSingleLevelIndent.repeat(numberOfSteps);
  }

  decreaseLogIndent(numberOfSteps: number = 1) {
    while (numberOfSteps-- > 0) {
      const endIndex = this.logIndent.lastIndexOf(this.logSingleLevelIndent);
      if (endIndex >= 0) {
        this.logIndent = this.logIndent.substring(0, endIndex);
      }
    }
  }

  log(message: string, ...values: unknown[]) {
    if (!this.logEnabled) {
      return;
    }
    const date = new Date(Date.now());
    const formattedDate = Logger.formatDate(date);
    console.log(formattedDate + " " + this.logIndent + message, ...values);
  }

  logEmptyLine() {
    if (!this.logEnabled) {
      return;
    }
    console.log("");
  }

  static formatDate(date: Date): string {
    return (
      date.getFullYear().toString().padStart(4, "0") + "-" +
      (date.getMonth() + 1).toString().padStart(2, "0") + "-" +
      date.getDate().toString().padStart(2, "0") + " " +
      date.getHours().toString().padStart(2, "0") + ":" +
      date.getMinutes().toString().padStart(2, "0") + ":" +
      date.getSeconds().toString().padStart(2, "0") + "." +
      date.getMilliseconds().toString().padStart(3, "0")
    );
  }
}

// Script constants
const ADDRESS_STUB: string = "0x1235678000000000000000000000000087654321";
const UINT256_MAX = ethers.MaxUint256;
const OWNER_ROLE = ethers.id("OWNER_ROLE");
const MINTER_ROLE = ethers.id("MINTER_ROLE");
const FREEZER_ROLE = ethers.id("FREEZER_ROLE");
const TRUSTED_SPENDER_ROLE = ethers.id("TRUSTED_SPENDER_ROLE");

const MINT_AMOUNT = 123456789012n;

const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);

async function main() {
  logger.log(`🏁 Checking migration of the roles ...`);
  logger.increaseLogIndent();

  const [owner] = await ethers.getSigners();

  logger.log("👉 contract name: ", CONTRACT_NAME);
  logger.log("👉 contract proxy address: ", PROXY_ADDRESS);
  logger.log("👉 owner address: ", owner.address);
  logger.logEmptyLine();

  const factory: ContractFactory = await ethers.getContractFactory(CONTRACT_NAME);
  const contract: Contract = (factory.attach(PROXY_ADDRESS) as Contract).connect(owner) as Contract;

  logger.log("▶ Checking the network...");
  await checkNetwork(owner);
  logger.log("✅ Done. The network has been checked successfully");

  logger.log("▶ Checking the contract version...");
  await checkContractVersion(contract);
  logger.log("✅ Done. The contract version is correct for executing this script");

  logger.log("▶ Checking if the owner has the right to configure the contract...");
  await checkAndConfigureOwnerRolesOnTheContract(contract, owner);
  logger.log("✅ Done. The owner has all needed roles.");

  logger.log("▶ Check operations before the upgrade...");
  await checkOperations(contract, owner);
  logger.log("✅ Done. The operations before the upgrade have been checked successfully");

  logger.log("▶ Configuring the contract new roles before the upgrade...");
  await configureNewRoles(contract, owner);
  logger.log("✅ Done. The new roles have been configured successfully");

  logger.log("▶ Upgrading contract for the first time...");
  await upgradeContract(contract, factory);
  logger.log("✅ Done. The contract has been upgraded successfully");

  logger.log("▶ Check operations after the upgrade...");
  await checkOperations(contract, owner);
  logger.log("✅ Done. The operations after the upgrade have been checked successfully");

  logger.log("🎉 Everything is done successfully");
}

main().then().catch(err => {
  throw err;
});

async function checkNetwork(owner: HardhatEthersSigner) {
  const actualNetwork = await owner.provider.getNetwork();
  if (actualNetwork.chainId !== BigInt(CHAIN_ID)) {
    throw Error(
      `❌ The network chain ID does not match the expected one. ` +
      `Expected: ${CHAIN_ID}, Actual: ${actualNetwork.chainId}`
    );
  }
  logger.increaseLogIndent();
  logger.log("👉 The network chain ID is: ", actualNetwork.chainId);
  logger.decreaseLogIndent();
}

async function checkContractVersion(contract: Contract) {
  const version = await contract.$__VERSION();
  if (version.major != 1 || version.minor != 4 || version.patch != 1) {
    throw Error("❌ The contract version is not 1.4.1. This script cannot be used for this contract version.");
  }
}

async function checkAndConfigureOwnerRolesOnTheContract(contract: Contract, owner: HardhatEthersSigner) {
  const oldAbi = [
    "function mainMinter() view returns (address)",
    "function isFreezer(address account) view returns (bool)",
    "function configureFreezerBatch(address[] calldata freezers, bool status) external",
    "function updateMainMinter(address newMinter) external",
    "function configureMinter(address minter, uint256 allowance) external",
    "function isTrustedAccount(address account) view returns (bool)",
    "function configureTrustedAccount(address account, bool isTrusted) external"
  ];
  const oldContract = new ethers.Contract(contract.target, oldAbi, contract.runner);

  const hasOwnerRole = await contract.hasRole(OWNER_ROLE, owner.address);
  if (!hasOwnerRole) {
    throw Error("❌ The provided owner does not have the OWNER_ROLE role");
  }

  logger.increaseLogIndent();

  const actualMainMinter = await oldContract.mainMinter();
  if (actualMainMinter != owner.address) {
    await proveTx(oldContract.updateMainMinter(owner.address));
    logger.log("👉 The owner has been set as the main minter");
  } else {
    logger.log("👉 The owner is already the main minter");
  }

  await proveTx(oldContract.configureMinter(owner.address, UINT256_MAX));
  logger.log("👉 The owner has been added as a minter");

  const isFreezer = await oldContract.isFreezer(owner.address);
  if (!isFreezer) {
    await proveTx(oldContract.configureFreezerBatch([owner.address], true));
    logger.log("👉 The owner has been added as a freezer");
  } else {
    logger.log("👉 The owner is already a freezer");
  }

  const isTrustedAccount = await oldContract.isTrustedAccount(owner.address);
  if (isTrustedAccount) {
    await proveTx(oldContract.configureTrustedAccount(owner.address, false));
    logger.log("👉 The owner has been removed as a trusted account");
  }
  const oldAllowance = await contract.allowance(ADDRESS_STUB, owner.address);
  if (oldAllowance != 0n) {
    throw Error(`❌ The address ${ADDRESS_STUB} usual allowance is not 0`);
  }
  await proveTx(oldContract.configureTrustedAccount(owner.address, true));
  logger.log("👉 The owner has been added as a trusted account");
  const newAllowance = await contract.allowance(ADDRESS_STUB, owner.address);
  if (newAllowance != UINT256_MAX) {
    throw Error(`❌ The address ${ADDRESS_STUB} allowance is not ${UINT256_MAX}`);
  }

  logger.decreaseLogIndent();
}

async function checkOperations(contract: Contract, owner: HardhatEthersSigner) {
  const tx1 = contract.mint(ADDRESS_STUB, MINT_AMOUNT);
  await expect(tx1).to.changeTokenBalance(contract, ADDRESS_STUB, MINT_AMOUNT);

  const tx2 = contract.transferFrom(ADDRESS_STUB, owner.address, MINT_AMOUNT);
  await expect(tx2).to.changeTokenBalances(contract, [ADDRESS_STUB, owner.address], [-MINT_AMOUNT, MINT_AMOUNT]);

  const tx3 = contract.burn(MINT_AMOUNT);
  await expect(tx3).to.changeTokenBalance(contract, owner.address, -MINT_AMOUNT);

  await contract.freeze(ADDRESS_STUB, MINT_AMOUNT);
  const frozenBalance1 = await contract.balanceOfFrozen(ADDRESS_STUB);
  if (frozenBalance1 != MINT_AMOUNT) {
    throw Error(`❌ The address ${ADDRESS_STUB} frozen balance is not ${MINT_AMOUNT}`);
  }

  await contract.freeze(ADDRESS_STUB, 0);
  const frozenBalance2 = await contract.balanceOfFrozen(ADDRESS_STUB);
  if (frozenBalance2 != 0n) {
    throw Error(`❌ The address ${ADDRESS_STUB} frozen balance is not 0`);
  }
}

async function configureNewRoles(contract: Contract, owner: HardhatEthersSigner) {
  await proveTx(contract.setRoleAdmin(MINTER_ROLE, OWNER_ROLE));
  await proveTx(contract.setRoleAdmin(FREEZER_ROLE, OWNER_ROLE));
  await proveTx(contract.setRoleAdmin(TRUSTED_SPENDER_ROLE, OWNER_ROLE));

  await proveTx(contract.grantRole(MINTER_ROLE, owner.address));
  await proveTx(contract.grantRole(FREEZER_ROLE, owner.address));
  await proveTx(contract.grantRole(TRUSTED_SPENDER_ROLE, owner.address));
}

async function upgradeContract(contract: Contract, factory: ContractFactory) {
  const upgradedContract = await upgrades.upgradeProxy(
    contract.target,
    factory,
    { redeployImplementation: "always" }
  );
  await upgradedContract.waitForDeployment();
}
