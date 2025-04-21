import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect } from "../../../test-utils/eth";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'OwnableUpgradeable'", async () => {
  const REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const REVERT_ERROR_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");

  let deployer: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  before(async () => {
    [deployer, stranger] = await ethers.getSigners();
  });

  async function deployContract(): Promise<{ ownableMock: Contract }> {
    // The contract factory with the explicitly specified deployer account
    let ownableMockFactory = await ethers.getContractFactory("OwnableUpgradeableMock");
    ownableMockFactory = ownableMockFactory.connect(deployer);

    // The contract under test with the explicitly specified initial account
    let ownableMock: Contract = await upgrades.deployProxy(ownableMockFactory) as Contract;
    await ownableMock.waitForDeployment();
    ownableMock = connect(ownableMock, deployer);

    return { ownableMock };
  }

  describe("Function 'initialize()' and internal initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { ownableMock } = await setUpFixture(deployContract);

      // The roles
      expect((await ownableMock.OWNER_ROLE()).toLowerCase()).to.equal(OWNER_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await ownableMock.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { ownableMock } = await setUpFixture(deployContract);
      await expect(
        ownableMock.initialize()
      ).to.be.revertedWithCustomError(ownableMock, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { ownableMock } = await setUpFixture(deployContract);
      await expect(
        ownableMock.callParentInitializerUnchained()
      ).to.be.revertedWithCustomError(ownableMock, REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Modifier 'onlyOwner()'", async () => {
    it("Executes as expected if the caller has the owner role", async () => {
      const { ownableMock } = await setUpFixture(deployContract);
      expect(await ownableMock.checkModifierOnlyOwner()).to.equal(true);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { ownableMock } = await setUpFixture(deployContract);

      await expect(connect(ownableMock, stranger).checkModifierOnlyOwner())
        .to.be.revertedWithCustomError(ownableMock, REVERT_ERROR_UNAUTHORIZED_ACCOUNT)
        .withArgs(stranger.address, OWNER_ROLE);
    });
  });
});
