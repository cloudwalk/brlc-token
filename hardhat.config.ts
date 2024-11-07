import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: process.env.SOLIDITY_VERSION ?? "",
    settings: {
      optimizer: {
        enabled: process.env.OPTIMIZER_ENABLED === "true",
        runs: Number(process.env.OPTIMIZER_RUNS)
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
      url: process.env.GANACHE_RPC,
      accounts: {
        mnemonic: process.env.GANACHE_MNEMONIC
      }
    },
    cw_testnet: {
      url: process.env.CW_TESTNET_RPC,
      accounts: process.env.CW_TESTNET_PK
        ? [process.env.CW_TESTNET_PK]
        : {
          mnemonic: process.env.CW_TESTNET_MNEMONIC ?? ""
        }
    },
    cw_mainnet: {
      url: process.env.CW_MAINNET_RPC,
      accounts: process.env.CW_MAINNET_PK
        ? [process.env.CW_MAINNET_PK]
        : {
          mnemonic: process.env.CW_MAINNET_MNEMONIC ?? ""
        }
    }
  },
  gasReporter: {
    enabled: process.env.GAS_REPORTER_ENABLED === "true"
  },
  contractSizer: {
    runOnCompile: process.env.CONTRACT_SIZER_ENABLED === "true"
  }
};

export default config;
