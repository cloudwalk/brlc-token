import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../../test-utils/eth";

async function setUpFixture(func: any) {
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

  let deployer: SignerWithAddress;
  let rescuer: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    rescuableFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    tokenFactory = await ethers.getContractFactory("ERC20TokenMock");
    [deployer, rescuer, user] = await ethers.getSigners();
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, ["ERC20 Test", "TEST"]);
    await token.deployed();
    return { token };
  }

  async function deployRescuable(): Promise<{ rescuable: Contract }> {
    const rescuable: Contract = await upgrades.deployProxy(rescuableFactory);
    await rescuable.deployed();
    return { rescuable };
  }

  async function deployAndConfigure(): Promise<{
    rescuable: Contract;
    token: Contract;
  }> {
    const { rescuable } = await deployRescuable();
    const { token } = await deployToken();
    await proveTx(token.mintForTest(rescuable.address, TOKEN_AMOUNT));
    await proveTx(rescuable.setRescuer(rescuer.address));
    return { rescuable, token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      expect(await rescuable.owner()).to.equal(deployer.address);
      expect(await rescuable.rescuer()).to.equal(ethers.constants.AddressZero);
    });

    it("Is reverted if called for the second time", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const rescuableImplementation: Contract = await rescuableFactory.deploy();
      await rescuableImplementation.deployed();
      await expect(rescuableImplementation.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.call_parent_initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
      );
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.call_parent_initialize_unchained()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
      );
    });
  });

  describe("Function 'setRescuer()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.connect(deployer).setRescuer(rescuer.address))
        .to.emit(rescuable, EVENT_NAME_RESCUER_CHANGED)
        .withArgs(rescuer.address);
      expect(await rescuable.rescuer()).to.equal(rescuer.address);
      await expect(rescuable.connect(deployer).setRescuer(rescuer.address)).not.to.emit(
        rescuable,
        EVENT_NAME_RESCUER_CHANGED
      );
    });

    it("Is reverted if called not by the owner", async () => {
      const { rescuable } = await setUpFixture(deployRescuable);
      await expect(rescuable.connect(rescuer).setRescuer(rescuer.address)).to.be.revertedWith(
        REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER
      );
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { rescuable, token } = await setUpFixture(deployAndConfigure);
      await expect(rescuable.connect(rescuer).rescueERC20(token.address, deployer.address, TOKEN_AMOUNT))
        .to.changeTokenBalances(token, [rescuable, deployer, rescuer], [-TOKEN_AMOUNT, +TOKEN_AMOUNT, 0])
        .and.to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(rescuable.address, deployer.address, TOKEN_AMOUNT);
    });

    it("Is reverted if called not by the rescuer", async () => {
      const { rescuable, token } = await setUpFixture(deployAndConfigure);
      await expect(
        rescuable.connect(user).rescueERC20(token.address, deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(rescuable, REVERT_ERROR_UNAUTHORIZED_RESCUER);
    });
  });
});
