import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'FaucetCallerUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let faucetCallerMock: Contract;
  let faucetMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const FaucetCallerMock: ContractFactory = await ethers.getContractFactory("FaucetCallerUpgradeableMock");
    faucetCallerMock = await upgrades.deployProxy(FaucetCallerMock);
    await faucetCallerMock.deployed();

    const FaucetMock: ContractFactory = await ethers.getContractFactory("FaucetMock");
    faucetMock = await FaucetMock.deploy();
    await faucetMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(faucetCallerMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(faucetCallerMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setFaucet()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(faucetCallerMock.connect(user).setFaucet(faucetMock.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Is reverted if is called by the owner but with incorrect faucet address", async () => {
      await expect(faucetCallerMock.setFaucet(faucetCallerMock.address))
        .to.be.reverted;
    });

    it("Executes successfully if is called by the owner with a correct non-zero faucet address", async () => {
      const expectedFaucetAddress: string = faucetMock.address;
      await proveTx(faucetCallerMock.setFaucet(expectedFaucetAddress));
      const actualFaucetAddress: string = await faucetCallerMock.getFaucet();
      expect(actualFaucetAddress).to.equal(expectedFaucetAddress);
    });

    it("Executes successfully if is called by the owner with zero faucet address", async () => {
      const expectedFaucetAddress: string = ethers.constants.AddressZero;
      await proveTx(faucetCallerMock.setFaucet(expectedFaucetAddress));
      const actualFaucetAddress: string = await faucetCallerMock.getFaucet();
      expect(actualFaucetAddress).to.equal(expectedFaucetAddress);
    });

    it("Emits the correct event if the faucet address is non-zero", async () => {
      const faucetAddress: string = faucetMock.address;
      await expect(faucetCallerMock.setFaucet(faucetAddress))
        .to.emit(faucetCallerMock, "FaucetChanged")
        .withArgs(faucetAddress);
    });

    it("Emits the correct event if the faucet address is zero", async () => {
      const faucetAddress: string = ethers.constants.AddressZero;
      await expect(faucetCallerMock.setFaucet(faucetAddress))
        .to.emit(faucetCallerMock, "FaucetChanged")
        .withArgs(faucetAddress);
    });
  });

  describe("Function 'faucetRequest()'", async () => {
    it("Does not call the 'withdraw()' function of the faucet if the faucet address is zero", async () => {
      expect(await faucetCallerMock.getFaucet()).to.equal(ethers.constants.AddressZero);
      await proveTx(faucetCallerMock.faucetRequest(user.address));
      expect(await faucetMock.lastWithdrawAddress()).to.equal(ethers.constants.AddressZero);
    });

    it("Calls the 'withdraw()' function of the faucet if the faucet address is non-zero", async () => {
      await proveTx(faucetCallerMock.setFaucet(faucetMock.address));
      expect(await faucetCallerMock.getFaucet()).to.equal(faucetMock.address);
      await proveTx(faucetCallerMock.faucetRequest(user.address));
      expect(await faucetMock.lastWithdrawAddress()).to.equal(user.address);
    });
  });
});
