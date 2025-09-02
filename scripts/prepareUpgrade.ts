import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const PROXY_ADDRESS = ""; // TBD: Enter proxy address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const response = await upgrades.prepareUpgrade(PROXY_ADDRESS, factory, {
    unsafeAllowRenames: false,
    unsafeSkipStorageCheck: false,
  });

  console.log("Upgrade prepared:", response);
}

main().catch((err) => {
  throw err;
});
