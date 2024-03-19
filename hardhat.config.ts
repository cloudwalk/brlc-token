import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: process.env.SOLIDITY_VERSION ?? "0.8.16",
    settings: {
      optimizer: {
        enabled: process.env.OPTIMIZER_ENABLED === "true",
        runs: 1000
      }
    }
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: process.env.HARDHAT_MNEMONIC
      }
    },
    ganache: {
      url: process.env.GANACHE_URL,
      accounts: {
        mnemonic: process.env.GANACHE_MNEMONIC
      }
    },
    cloudwalk_testnet: {
      url: process.env.CLOUDWALK_TESTNET_URL,
      accounts: [PRIVATE_KEY]
    },
    cloudwalk_mainnet: {
      url: process.env.CLOUDWALK_MAINNET_URL,
      accounts: [PRIVATE_KEY]
    }
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER_ENABLED === "true"
  }
};

export default config;
