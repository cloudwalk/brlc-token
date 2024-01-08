import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME: string = ""; // TBD: Enter contract name

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const proxy = await upgrades.deployProxy(factory);

  await proxy.deployed();

  console.log("Proxy deployed to:", await proxy.address);
}

main();
