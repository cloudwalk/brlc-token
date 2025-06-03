import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getAddress, proveTx } from "../../../test-utils/eth";
import { setUpFixture } from "../../../test-utils/common";

describe("Contract 'RescuableUpgradeable'", async () => {
  const EVENT_NAME_TRANSFER = "Transfer";

  const ERROR_NAME_IF_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const ERROR_NAME_IF_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const ERROR_NAME_IF_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");

  const TOKEN_AMOUNT = 123;

  let deployer: HardhatEthersSigner;
  let rescuer: HardhatEthersSigner;

  before(async () => {
    [deployer, rescuer] = await ethers.getSigners();
  });

  async function deployRescuableMock(): Promise<{ rescuableMock: Contract }> {
    // The contract factory with the explicitly specified deployer account
    let rescuableMockFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    rescuableMockFactory = rescuableMockFactory.connect(deployer);

    // The contract under test with the explicitly specified initial account
    let rescuableMock = await upgrades.deployProxy(rescuableMockFactory) as Contract;
    await rescuableMock.waitForDeployment();
    rescuableMock = connect(rescuableMock, deployer); // Explicitly specifying the initial account

    return { rescuableMock };
  }

  async function deployTokenMock(): Promise<{ tokenMock: Contract }> {
    // The token contract factory with the explicitly specified deployer account
    let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);

    // The token contract with the explicitly specified initial account
    let tokenMock = await tokenMockFactory.deploy("ERC20 Test", "TEST") as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer); // Explicitly specifying the initial account

    return { tokenMock };
  }

  async function deployAndConfigureAllContracts(): Promise<{
    rescuableMock: Contract;
    tokenMock: Contract;
  }> {
    const { rescuableMock } = await deployRescuableMock();
    const { tokenMock } = await deployTokenMock();

    await proveTx(tokenMock.mint(getAddress(rescuableMock), TOKEN_AMOUNT));
    await proveTx(rescuableMock.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(rescuableMock.grantRole(RESCUER_ROLE, rescuer.address));

    return {
      rescuableMock,
      tokenMock
    };
  }

  describe("Function 'initialize()' and internal initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);

      // The role hashes
      expect((await rescuableMock.OWNER_ROLE()).toLowerCase()).to.equal(OWNER_ROLE);
      expect((await rescuableMock.GRANTOR_ROLE()).toLowerCase()).to.equal(GRANTOR_ROLE);
      expect((await rescuableMock.RESCUER_ROLE()).toLowerCase()).to.equal(RESCUER_ROLE);

      // The role admins
      expect(await rescuableMock.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await rescuableMock.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await rescuableMock.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await rescuableMock.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await rescuableMock.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await rescuableMock.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.initialize()
      ).to.be.revertedWithCustomError(rescuableMock, ERROR_NAME_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.callParentInitializerUnchained()
      ).to.be.revertedWithCustomError(rescuableMock, ERROR_NAME_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { rescuableMock, tokenMock } = await setUpFixture(deployAndConfigureAllContracts);

      const rescuableMockConnected = connect(rescuableMock, rescuer);
      const tx = rescuableMockConnected.rescueERC20(getAddress(tokenMock), deployer.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [rescuableMock, deployer, rescuer],
        [-TOKEN_AMOUNT, +TOKEN_AMOUNT, 0]
      );
      await expect(tx)
        .to.emit(tokenMock, EVENT_NAME_TRANSFER)
        .withArgs(getAddress(rescuableMock), deployer.address, TOKEN_AMOUNT);
    });

    it("Is reverted if it is called by an account without the rescuer role", async () => {
      const { rescuableMock, tokenMock } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        rescuableMock.rescueERC20(getAddress(tokenMock), deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(
        rescuableMock,
        ERROR_NAME_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, RESCUER_ROLE);
    });
  });
});
