import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME: string = ""; // TBD: Enter contract name
  const PROXY_ADDRESS: string = ""; // TBD: Enter proxy address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  await upgrades.validateUpgrade(PROXY_ADDRESS, factory, {
    unsafeAllowRenames: false,
    unsafeSkipStorageCheck: false
  });

  console.log("Successfully validated");
}

main().then().catch(err => {
  throw err;
});
