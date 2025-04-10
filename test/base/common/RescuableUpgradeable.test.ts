import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, getAddress, proveTx } from "../../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'RescuableUpgradeable'", async () => {
  const TOKEN_AMOUNT = 100;

  const EVENT_NAME_TRANSFER = "Transfer";
  const EVENT_NAME_RESCUER_CHANGED = "RescuerChanged";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_UNAUTHORIZED_RESCUER = "UnauthorizedRescuer";

  let rescuableFactory: ContractFactory;
  let tokenFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let rescuer: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, rescuer, user] = await ethers.getSigners();
    rescuableFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    tokenFactory = await ethers.getContractFactory("ERC20TokenMock");
    rescuableFactory = rescuableFactory.connect(deployer); // Explicitly specifying the deployer account
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, ["ERC20 Test", "TEST"]) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployRescuable(): Promise<{ rescuable: Contract }> {
    let rescuable: Contract = await upgrades.deployProxy(rescuableFactory) as Contract;
    await rescuable.waitForDeployment();
    rescuable = connect(rescuable, deployer); // Explicitly specifying the initial account
    return { rescuable };
  }

  async function deployAndConfigure(): Promise<{
    rescuable: Contract;
    token: Contract;
  }> {
    const { rescuable } = await deployRescuable();
    const { token } = await deployToken();
    await proveTx(token.mintForTest(getAddress(rescuable), TOKEN_AMOUNT));
    await proveTx(rescuable.setRescuer(rescuer.address));
    return { rescuable, token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      expect(await rescuable.owner()).to.equal(deployer.address);
      expect(await rescuable.rescuer()).to.equal(ethers.ZeroAddress);
    });

    it("Is reverted if called for the second time", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(
        rescuable.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const rescuableImplementation: Contract = await rescuableFactory.deploy() as Contract;
      await rescuableImplementation.waitForDeployment();
      await expect(
        rescuableImplementation.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(
        rescuable.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setRescuer()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.setRescuer(rescuer.address))
        .to.emit(rescuable, EVENT_NAME_RESCUER_CHANGED)
        .withArgs(rescuer.address);
      expect(await rescuable.rescuer()).to.equal(rescuer.address);
      await expect(
        rescuable.setRescuer(rescuer.address)
      ).not.to.emit(rescuable, EVENT_NAME_RESCUER_CHANGED);
    });

    it("Is reverted if called not by the owner", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(
        connect(rescuable, rescuer).setRescuer(rescuer.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { rescuable, token } = await setUpFixture(deployAndConfigure);
      const tx = connect(rescuable, rescuer).rescueERC20(
        getAddress(token),
        deployer.address,
        TOKEN_AMOUNT
      );
      await expect(tx).to.changeTokenBalances(
        token,
        [rescuable, deployer, rescuer],
        [-TOKEN_AMOUNT, +TOKEN_AMOUNT, 0]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(getAddress(rescuable), deployer.address, TOKEN_AMOUNT);
    });

    it("Is reverted if called not by the rescuer", async () => {
      const { rescuable, token } = await setUpFixture(deployAndConfigure);
      await expect(
        connect(rescuable, user).rescueERC20(getAddress(token), deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(rescuable, REVERT_ERROR_UNAUTHORIZED_RESCUER);
    });
  });
});
