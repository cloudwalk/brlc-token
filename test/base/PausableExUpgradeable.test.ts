import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'PausableExUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER = "PausableEx: caller is not the pauser";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let pausableExMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const PausableExMock: ContractFactory = await ethers.getContractFactory("PausableExUpgradeableMock");
    pausableExMock = await upgrades.deployProxy(PausableExMock);
    await pausableExMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(pausableExMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(pausableExMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setPauser()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(pausableExMock.connect(user).setPauser(user.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedPauserAddress: string = user.address;
      await proveTx(pausableExMock.setPauser(expectedPauserAddress));
      const actualPauserAddress: string = await pausableExMock.getPauser();
      expect(actualPauserAddress).to.equal(expectedPauserAddress);
    });

    it("Emits the correct event", async () => {
      const pauserAddress: string = user.address;
      await expect(pausableExMock.setPauser(pauserAddress))
        .to.emit(pausableExMock, "PauserChanged")
        .withArgs(pauserAddress);
    });
  });

  describe("Function 'pause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExMock.setPauser(user.address));
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(pausableExMock.pause())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Executes successfully if is called by the pauser", async () => {
      await proveTx(pausableExMock.connect(user).pause());
      expect(await pausableExMock.paused()).to.equal(true);
    });

    it("Emits the correct event", async () => {
      await expect(pausableExMock.connect(user).pause())
        .to.emit(pausableExMock, "Paused")
        .withArgs(user.address);
    });
  });

  describe("Function 'unpause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExMock.setPauser(user.address));
      await proveTx(pausableExMock.connect(user).pause());
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(pausableExMock.unpause())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Executes successfully if is called by the pauser", async () => {
      await proveTx(pausableExMock.connect(user).unpause());
      expect(await pausableExMock.paused()).to.equal(false);
    });

    it("Emits the correct event", async () => {
      await expect(pausableExMock.connect(user).unpause())
        .to.emit(pausableExMock, "Unpaused")
        .withArgs(user.address);
    });
  });
});
