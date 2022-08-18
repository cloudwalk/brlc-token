import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
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
        mnemonic: 'test test test test test test test test test test test junk'
      },
    },
    ganache: {
      url: 'http://127.0.0.1:7545',
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk'
      }
    },
    substrate: {
      url: "http://127.0.0.1:9933",
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
      },
      gas: "auto"
    },
  },
  mocha: {
    timeout: 120000
  },
};
