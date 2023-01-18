import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'RescuableUpgradeable'", async () => {
  const TOKEN_AMOUNT = 123;

  const EVENT_NAME_RESCUER_CHANGED = "RescuerChanged";
  const EVENT_NAME_TRANSFER = "Transfer";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_IF_CALLER_IS_NOT_RESCUER = "UnauthorizedRescuer";

  let rescuableMockFactory: ContractFactory;
  let tokenMockFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let rescuer: SignerWithAddress;

  before(async () => {
    rescuableMockFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    tokenMockFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    [deployer, rescuer] = await ethers.getSigners();
  });

  async function deployRescuableMock(): Promise<{ rescuableMock: Contract }> {
    const rescuableMock: Contract = await upgrades.deployProxy(rescuableMockFactory);
    await rescuableMock.deployed();
    return { rescuableMock };
  }

  async function deployTokenMock(): Promise<{ tokenMock: Contract }> {
    const tokenMock: Contract = await upgrades.deployProxy(tokenMockFactory, ["ERC20 Test", "TEST"]);
    await tokenMock.deployed();
    return { tokenMock };
  }

  async function deployAndConfigureAllContracts(): Promise<{ rescuableMock: Contract, tokenMock: Contract }> {
    const { rescuableMock } = await deployRescuableMock();
    const { tokenMock } = await deployTokenMock();

    await proveTx(tokenMock.mint(rescuableMock.address, TOKEN_AMOUNT));
    await proveTx(rescuableMock.setRescuer(rescuer.address));

    return {
      rescuableMock,
      tokenMock
    };
  }

  describe("Function 'initialize()'", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);

      expect(await rescuableMock.owner()).to.equal(deployer.address);
      expect(await rescuableMock.rescuer()).to.equal(ethers.constants.AddressZero);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The internal initializer is reverted if it is called outside the init process", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.call_parent_initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setRescuer()'", async () => {
    it("Executes successfully and emits the correct event if it is called by the owner", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.setRescuer(rescuer.address)
      ).to.emit(
        rescuableMock,
        EVENT_NAME_RESCUER_CHANGED
      ).withArgs(rescuer.address);
      expect(await rescuableMock.rescuer()).to.equal(rescuer.address);

      // The second call with the same argument should not emit an event
      await expect(
        rescuableMock.setRescuer(rescuer.address)
      ).not.to.emit(rescuableMock, EVENT_NAME_RESCUER_CHANGED);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { rescuableMock } = await setUpFixture(deployRescuableMock);
      await expect(
        rescuableMock.connect(rescuer).setRescuer(rescuer.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { rescuableMock, tokenMock } = await setUpFixture(deployAndConfigureAllContracts);

      await expect(
        rescuableMock.connect(rescuer).rescueERC20(
          tokenMock.address,
          deployer.address,
          TOKEN_AMOUNT
        )
      ).to.changeTokenBalances(
        tokenMock,
        [rescuableMock, deployer, rescuer],
        [-TOKEN_AMOUNT, +TOKEN_AMOUNT, 0]
      ).and.to.emit(
        tokenMock,
        EVENT_NAME_TRANSFER
      ).withArgs(
        rescuableMock.address,
        deployer.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if it is called not by the rescuer", async () => {
      const { rescuableMock, tokenMock } = await setUpFixture(deployAndConfigureAllContracts);
      await expect(
        rescuableMock.rescueERC20(
          tokenMock.address,
          deployer.address,
          TOKEN_AMOUNT
        )
      ).to.be.revertedWithCustomError(rescuableMock, REVERT_ERROR_IF_CALLER_IS_NOT_RESCUER);
    });
  });
});
