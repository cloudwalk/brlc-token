import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'RescuableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_IF_CALLER_IS_NOT_RESCUER = "UnauthorizedRescuer";

  let rescuableMock: Contract;
  let deployer: SignerWithAddress;
  let rescuer: SignerWithAddress;

  beforeEach(async () => {
    const RescuableMock: ContractFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    rescuableMock = await RescuableMock.deploy();
    await rescuableMock.deployed();
    await proveTx(rescuableMock.initialize());

    [deployer, rescuer] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      rescuableMock.initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The init function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      rescuableMock.call_parent_initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The init unchained function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      rescuableMock.call_parent_initialize_unchained()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The initial contract configuration should be as expected", async () => {
    expect(await rescuableMock.owner()).to.equal(deployer.address);
    expect(await rescuableMock.rescuer()).to.equal(ethers.constants.AddressZero);
  });

  describe("Function 'setRescuer()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(
        rescuableMock.connect(rescuer).setRescuer(rescuer.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully and emits the correct event if is called by the owner", async () => {
      await expect(
        rescuableMock.setRescuer(rescuer.address)
      ).to.emit(
        rescuableMock,
        "RescuerChanged"
      ).withArgs(rescuer.address);
      expect(await rescuableMock.rescuer()).to.equal(rescuer.address);

      // The second call with the same argument should not emit an event
      await expect(
        rescuableMock.setRescuer(rescuer.address)
      ).not.to.emit(rescuableMock, "RescuerChanged");
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    const tokenBalance: number = 123;
    let testTokenMock: Contract;

    beforeEach(async () => {
      const ERC20Mock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
      testTokenMock = await ERC20Mock.deploy();
      await testTokenMock.deployed();
      await proveTx(testTokenMock.initialize("Test Token", "TEST"));

      await proveTx(testTokenMock.mint(rescuableMock.address, tokenBalance));
      await proveTx(rescuableMock.setRescuer(rescuer.address));
    });

    it("Is reverted if is called not by the rescuer", async () => {
      await expect(
        rescuableMock.rescueERC20(testTokenMock.address, rescuer.address, tokenBalance)
      ).to.be.revertedWithCustomError(rescuableMock, REVERT_ERROR_IF_CALLER_IS_NOT_RESCUER);
    });

    it("Transfers the correct amount of tokens", async () => {
      await expect(
        rescuableMock.connect(rescuer).rescueERC20(testTokenMock.address, deployer.address, tokenBalance)
      ).to.changeTokenBalances(
        testTokenMock,
        [rescuableMock, deployer, rescuer],
        [-tokenBalance, tokenBalance, 0]
      );
    });
  });
});
