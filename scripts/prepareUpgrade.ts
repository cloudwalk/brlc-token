import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME: string = ""; // TBD: Enter contract name
  const PROXY_ADDRESS: string = ""; // TBD: Enter proxy address

  // Upgrade options:
  // unsafeAllowRenames: true
  // unsafeSkipStorageCheck: true

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  await upgrades.prepareUpgrade(PROXY_ADDRESS, factory);

  console.log("Upgrade prepared");
}

main().then().catch(err => {
  throw err;
});
