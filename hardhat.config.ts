import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.16",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
      initialDate: "01 Dec 2023 00:00:00 GMT" //It's needed for BalanceTracker test
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk"
      }
    },
    substrate: {
      url: "http://127.0.0.1:9933",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
      gas: "auto"
    },
  },
};

export default config;
