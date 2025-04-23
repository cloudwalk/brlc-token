import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory, Wallet } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { proveTx } from "../test-utils/eth";

// Script input parameters
const MNEMONIC: string = process.env.SP_MNEMONIC ?? "test test test test test test test test test test test junk";
const CONTRACT_NAME: string = process.env.SP_CONTRACT_NAME ?? "BRLCToken";
const PROXY_ADDRESS: string = process.env.SP_PROXY_ADDRESS ?? ""; // TBD: Enter proxy address
const CHAIN_ID: number = parseInt(process.env.SP_CHAIN_ID ?? ""); // TBD: Enter proxy address

interface ContractState {
  name: string;
  symbol: string;
  balance: bigint;
  allowance: bigint;
  totalSupply: bigint;
  frozenBalance: bigint;
  isFreezer: boolean;
  numberOfBeforeTokenTransferHooks: number;
  firstBeforeTokenTransferHookAddress: string;
  numberOfAfterTokenTransferHooks: number;
  firstAfterTokenTransferHookAddress: string;
  totalReserveSupply: bigint;
  mainMinterAddress: string;
  isMinter: boolean;
  minterAllowance: bigint;
  isTrustedAccount: boolean;

  [key: string]: bigint | number | boolean | string;
}

interface AccountAddresses {
  user: string;
  spender: string;
  frozen: string;
  freezer: string;
  minter: string;

  [key: string]: string;
}

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
const ADDRESS_ZERO = ethers.ZeroAddress;

const TARGET_BALANCE = 123456789012n;
const TARGET_ALLOWANCE = 234567890123n;
const TARGET_FROZEN_BALANCE = 345678901234n;
const TARGET_RESERVE_SUPPLY = 456789012345n;
const TARGET_MINTER_ALLOWANCE = 567890123456n;

const logSingleLevelIndent = "  ";
const logger: Logger = new Logger(logSingleLevelIndent);
const defaultAccountAddresses: AccountAddresses = {
  user: ADDRESS_ZERO,
  spender: ethers.ZeroAddress,
  frozen: ethers.ZeroAddress,
  freezer: ethers.ZeroAddress,
  minter: ethers.ZeroAddress,
  trusted: ethers.ZeroAddress
};
const defaultContractState: ContractState = {
  name: "",
  symbol: "",
  balance: 0n,
  allowance: 0n,
  totalSupply: 0n,
  frozenBalance: 0n,
  isFreezer: false,
  numberOfBeforeTokenTransferHooks: 0,
  firstBeforeTokenTransferHookAddress: ADDRESS_ZERO,
  numberOfAfterTokenTransferHooks: 0,
  firstAfterTokenTransferHookAddress: ADDRESS_ZERO,
  totalReserveSupply: 0n,
  mainMinterAddress: ADDRESS_ZERO,
  isMinter: false,
  minterAllowance: 0n,
  isTrustedAccount: false
};

async function main() {
  logger.log(`🏁 Checking migration of the contract storage to OpenZeppelin V5 ...`);
  logger.increaseLogIndent();

  const [owner] = await ethers.getSigners();
  const accountAddresses = createAddresses();

  logger.log("👉 contract name: ", CONTRACT_NAME);
  logger.log("👉 contract proxy address: ", PROXY_ADDRESS);
  logger.log("👉 deployer address: ", owner.address);
  logger.log("👉 account addresses: ", accountAddresses);
  logger.logEmptyLine();

  const factory: ContractFactory = await ethers.getContractFactory(CONTRACT_NAME);
  const contract: Contract = (factory.attach(PROXY_ADDRESS) as Contract).connect(owner) as Contract;

  logger.log("▶ Checking the network...");
  await checkNetwork(owner);
  logger.log("✅ Done. The network has been reset successfully");

  logger.log("▶ Checking the contract version...");
  await checkContractVersion(contract);
  logger.log("✅ Done. The contract version is correct for executing this script.");

  logger.log("▶ Checking if the owner has the right to configure the contract...");
  await checkAndConfigureOwnerRolesOnTheContract(contract, owner);
  logger.log("✅ Done. The owner has all needed roles.");

  logger.log("▶ Configuring the contract state before migration...");
  await configureContract(contract, accountAddresses);
  logger.log("✅ Done. The contract has been configured successfully");

  logger.log("▶ Collecting the contract state before migration...");
  const stateBeforeMigration: ContractState = await collectContractState(contract, owner, accountAddresses);
  logger.log("✅ Done. The contract state before migration:", stateBeforeMigration);

  logger.log("▶ Upgrading contract for the first time...");
  await upgradeContract(contract, factory);
  logger.log("✅ Done. The contract has been upgraded successfully");

  logger.log("▶ Migrating contract...");
  await migrateContractStorage(contract, owner);
  logger.log("✅ Done. The contract has been migrated successfully");

  logger.log("▶ Collecting contract state after migration...");
  const stateAfterMigration: ContractState = await collectContractState(contract, owner, accountAddresses);
  logger.log("✅ Done. The contract state after migration:", stateAfterMigration);

  logger.log("▶ Checking if the contract state is the same as before the migration...");
  checkEquality(stateAfterMigration, stateBeforeMigration);
  logger.log("✅ Done. The contract state is the same as before the migration.");

  logger.log("▶ Upgrading contract for the second time...");
  await upgradeContract(contract, factory);
  logger.log("✅ Done. The contract has been upgraded successfully");

  logger.log("▶ Collecting contract state after the second upgrade...");
  const stateAfterSecondUpgrade: ContractState = await collectContractState(contract, owner, accountAddresses);
  logger.log("✅ Done. The contract state after the second upgrade:", stateAfterSecondUpgrade);

  logger.log("▶ Checking if the contract state is the same as before the migration...");
  checkEquality(stateAfterSecondUpgrade, stateBeforeMigration);
  logger.log("✅ Done. The contract state is the same as before the migration.");

  logger.log("🎉 Everything is done.");
}

main().then().catch(err => {
  throw err;
});

function createAddresses(): AccountAddresses {
  const addresses = createWalletsFromMnemonic(MNEMONIC, Object.keys(defaultAccountAddresses).length)
    .map(wallet => wallet.address);
  return {
    ...defaultAccountAddresses,
    user: addresses[0],
    spender: addresses[1],
    frozen: addresses[2],
    freezer: addresses[3],
    minter: addresses[4],
    trusted: addresses[5]
  };
}

function createWalletsFromMnemonic(mnemonic: string, numberOfWallets: number): Wallet[] {
  const mnemonicObj = ethers.Mnemonic.fromPhrase(mnemonic);
  const hdNodeWallet = ethers.HDNodeWallet.fromMnemonic(mnemonicObj);
  return Array.from({ length: numberOfWallets }, (_, i) => {
    return new Wallet(hdNodeWallet.deriveChild(i).privateKey);
  });
}

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
  if (version.major != 1 || version.minor != 3) {
    throw Error("❌ The contract version is not 1.3.x. This script cannot be used for this contract version.");
  }
}

async function checkAndConfigureOwnerRolesOnTheContract(contract: Contract, owner: HardhatEthersSigner) {
  const ownerInterface = new ethers.Interface([
    "function owner() view returns (address)"
  ]);
  const ownerContract = new ethers.Contract(contract.target, ownerInterface, contract.runner);
  const actualOwner = await ownerContract.owner();
  if (actualOwner != owner.address) {
    throw Error(
      "❌ The owner does not have the right to configure the contract. " +
      `Expected: ${owner.address}, Actual: ${actualOwner}`
    );
  }
  const actualMainMinter = await contract.mainMinter();
  if (actualMainMinter != owner.address) {
    await proveTx(contract.updateMainMinter(owner.address));
    logger.increaseLogIndent();
    logger.log("👉 The owner has been set as the main minter");
    logger.decreaseLogIndent();
  }

  await proveTx(contract.configureMinter(owner.address, ethers.MaxUint256));
  logger.increaseLogIndent();
  logger.log("👉 The owner has been added as a minter");
  logger.decreaseLogIndent();

  const isFreezer = await contract.isFreezer(owner.address);
  if (!isFreezer) {
    await proveTx(contract.configureFreezerBatch([owner.address], [true]));
    logger.increaseLogIndent();
    logger.log("👉 The owner has been added as a freezer");
    logger.decreaseLogIndent();
  }
}

async function configureContract(contract: Contract, accountAddresses: AccountAddresses) {
  const currentBalance = await contract.balanceOf(accountAddresses.user);
  const currentReserveSupply = await contract.totalReserveSupply();

  await proveTx(contract.mint(accountAddresses.user, TARGET_BALANCE - currentBalance));
  await proveTx(contract.approve(accountAddresses.spender, TARGET_ALLOWANCE));
  await proveTx(contract.freeze(accountAddresses.frozen, TARGET_FROZEN_BALANCE));
  await proveTx(contract.configureFreezerBatch([accountAddresses.freezer], [true]));
  await proveTx(contract.mintFromReserve(accountAddresses.minter, TARGET_RESERVE_SUPPLY - currentReserveSupply));
  await proveTx(contract.configureMinter(accountAddresses.minter, TARGET_MINTER_ALLOWANCE));
  await proveTx(contract.configureTrustedAccount(accountAddresses.trusted, true));
}

async function collectContractState(
  contract: Contract,
  owner: HardhatEthersSigner,
  accountAddresses: AccountAddresses
): Promise<ContractState> {
  const state: ContractState = { ...defaultContractState };
  state.name = await contract.name();
  state.symbol = await contract.symbol();
  state.balance = await contract.balanceOf(accountAddresses.user);
  state.allowance = await contract.allowance(owner.address, accountAddresses.spender);
  state.totalSupply = await contract.totalSupply();
  state.frozenBalance = await contract.balanceOfFrozen(accountAddresses.frozen);
  state.isFreezer = await contract.isFreezer(accountAddresses.freezer);

  const beforeTokenTransferHooks = await contract.getBeforeTokenTransferHooks();
  const afterTokenTransferHooks = await contract.getAfterTokenTransferHooks();
  state.numberOfBeforeTokenTransferHooks = beforeTokenTransferHooks.length;
  if (state.numberOfBeforeTokenTransferHooks > 0) {
    state.firstBeforeTokenTransferHookAddress = beforeTokenTransferHooks[0].account;
  }
  state.numberOfAfterTokenTransferHooks = afterTokenTransferHooks.length;
  if (state.numberOfAfterTokenTransferHooks > 0) {
    state.firstAfterTokenTransferHookAddress = afterTokenTransferHooks[0].account;
  }

  state.totalReserveSupply = await contract.totalReserveSupply();
  state.mainMinterAddress = await contract.mainMinter();
  state.isMinter = await contract.isMinter(accountAddresses.minter);
  state.minterAllowance = await contract.minterAllowance(accountAddresses.minter);
  state.isTrustedAccount = await contract.isTrustedAccount(accountAddresses.trusted);
  return state;
}

async function upgradeContract(contract: Contract, factory: ContractFactory) {
  const upgradedContract = await upgrades.upgradeProxy(
    contract.target,
    factory,
    { redeployImplementation: "always" }
  );
  await upgradedContract.waitForDeployment();
}

async function migrateContractStorage(contract: Contract, owner: HardhatEthersSigner) {
  const oldValuesBefore = await contract.getOldStorageVariables();
  if (!oldValuesBefore[0]) {
    throw Error("❌ The old initialized value is false. The contract could already be migrated");
  }

  await proveTx(contract.migrateStorage());

  const oldValuesAfter = await contract.getOldStorageVariables();
  const newInitialized: boolean = await contract.getNewStorageInitializedState();
  const isOwner = await contract.hasRole(await contract.OWNER_ROLE(), owner.address);
  if (!isOwner) {
    throw Error("❌ The owner account does not have the 'OWNER_ROLE' role after the migration");
  }

  logger.increaseLogIndent();
  logger.log("👉 The old initialized value before and after the migration: ", oldValuesBefore[0], oldValuesAfter[0]);
  logger.log("👉 The old owner address before and after the migration: ", oldValuesBefore[1], oldValuesAfter[1]);
  logger.log("👉 The old pasuer address before and after the migration: ", oldValuesBefore[2], oldValuesAfter[2]);
  logger.log("👉 The old rescuer address before and after the migration: ", oldValuesBefore[3], oldValuesAfter[3]);
  logger.log("👉 The new initialized value after the migration: ", newInitialized);
  logger.decreaseLogIndent();
}

export function checkEquality<T extends Record<string, unknown>>(
  actualObject: T,
  expectedObject: T,
  index?: number,
  props: {
    ignoreObjects: boolean;
  } = { ignoreObjects: false }
) {
  const indexString = index == null ? "" : ` with index: ${index}`;
  Object.keys(expectedObject).forEach(property => {
    const value = actualObject[property];
    if (typeof value === "undefined" || typeof value === "function") {
      throw Error(`Property "${property}" is not found in the actual object` + indexString);
    }
    if (typeof expectedObject[property] === "object" && props.ignoreObjects) {
      return;
    }
    if (value !== expectedObject[property]) {
      throw Error(
        `Mismatch in the "${property}" property between the actual object and expected one` + indexString +
        `\nExpected: ${expectedObject[property]}, Actual: ${value}`
      );
    }
  });
}
