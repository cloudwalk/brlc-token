import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const TOKEN_NAME = ""; // TBD: Enter token name
  const TOKEN_SYMBOL = ""; // TBD: Enter token symbol

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const proxy = await upgrades.deployProxy(
    factory,
    [TOKEN_NAME, TOKEN_SYMBOL],
    { kind: "transparent" },
  );

  await proxy.waitForDeployment();

  console.log("Proxy deployed:", await proxy.getAddress());
}

main().catch((err) => {
  throw err;
});
