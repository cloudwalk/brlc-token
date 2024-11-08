import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME: string = ""; // TBD: Enter contract name
  const TOKEN_NAME: string = ""; // TBD: Enter token name
  const TOKEN_SYMBOL: string = ""; // TBD: Enter token symbol

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const proxy = await upgrades.deployProxy(factory, [TOKEN_NAME, TOKEN_SYMBOL]);

  await proxy.waitForDeployment();

  console.log("Proxy deployed:", await proxy.getAddress());
}

main()
  .then()
  .catch(err => {
    throw err;
  });
