import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'RandomableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER: string = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED: string = 'Initializable: contract is already initialized';

  let randomableMock: Contract;
  let deployer: SignerWithAddress;
  let pseudoRandomProvider: SignerWithAddress;

  beforeEach(async () => {
    const RandomableMock: ContractFactory = await ethers.getContractFactory("RandomableUpgradeableMock");
    randomableMock = await upgrades.deployProxy(RandomableMock);
    await randomableMock.deployed();

    [deployer, pseudoRandomProvider] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(randomableMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(randomableMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setRandomProvider()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(randomableMock.connect(pseudoRandomProvider).setRandomProvider(pseudoRandomProvider.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedRandomProviderAddress: string = pseudoRandomProvider.address;
      await proveTx(randomableMock.setRandomProvider(expectedRandomProviderAddress));
      const actualRandomProviderAddress: string = await randomableMock.getRandomProvider();
      expect(actualRandomProviderAddress).to.equal(expectedRandomProviderAddress);
    });

    it("Emits the correct event", async () => {
      const randomProviderAddress: string = pseudoRandomProvider.address;
      await expect(randomableMock.setRandomProvider(randomProviderAddress))
        .to.emit(randomableMock, "RandomProviderChanged")
        .withArgs(randomProviderAddress);
    });
  });

  describe("Function 'getRandomness()'", async () => {
    let randomProviderMock: Contract;

    beforeEach(async () => {
      //Deploy a mock random provider
      const RandomProviderMock: ContractFactory = await ethers.getContractFactory("RandomProviderMock");
      randomProviderMock = await RandomProviderMock.deploy();
      await randomProviderMock.deployed();

      await proveTx(randomableMock.setRandomProvider(randomProviderMock.address));
    });

    it("Returns the value from the random provider", async () => {
      const expectedRandomValue: number = 123;
      await proveTx(randomProviderMock.setRandomNumber(expectedRandomValue));
      const actualRandomValue: number = await randomableMock.getRandomness();
      expect(actualRandomValue).to.equal(expectedRandomValue);
    });
  });
});
