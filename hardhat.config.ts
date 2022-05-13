import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.7.6",
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
  },
};
