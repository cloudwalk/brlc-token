import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import dotenv from "dotenv";

dotenv.config();
const DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

function mnemonicOrDefault(mnemonic: string | undefined) {
  return {
    mnemonic: mnemonic ?? DEFAULT_MNEMONIC,
  };
}

function pkOrEmpty(pk: string | undefined) {
  return pk ? [pk] : undefined;
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: Number(process.env.OPTIMIZER_RUNS ?? 1000),
      },
    },
  },
  networks: {
    hardhat: {
      accounts: mnemonicOrDefault(process.env.HARDHAT_MNEMONIC),
    },
    stratus: {
      url: `http://localhost:${process.env.STRATUS_PORT || 3000}`,
      accounts: mnemonicOrDefault(process.env.STRATUS_MNEMONIC),
      timeout: 40000,
    },
    ganache: {
      url: process.env.GANACHE_RPC ?? "",
      accounts: mnemonicOrDefault(process.env.GANACHE_MNEMONIC),
    },
    cw_testnet: {
      url: process.env.CW_TESTNET_RPC ?? "",
      accounts: pkOrEmpty(process.env.CW_TESTNET_PK) ?? mnemonicOrDefault(process.env.CW_TESTNET_MNEMONIC),
    },
    cw_mainnet: {
      url: process.env.CW_MAINNET_RPC ?? "",
      accounts: pkOrEmpty(process.env.CW_MAINNET_PK) ?? mnemonicOrDefault(process.env.CW_MAINNET_MNEMONIC),
    },
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER_ENABLED === "true",
  },
  contractSizer: {
    runOnCompile: process.env.CONTRACT_SIZER_ENABLED === "true",
  },
};

export default config;
