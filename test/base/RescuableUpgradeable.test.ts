import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'RescuableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_RESCUER = "Rescuable: caller is not the rescuer";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let rescuableMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const RescuableMock: ContractFactory = await ethers.getContractFactory("RescuableUpgradeableMock");
    rescuableMock = await upgrades.deployProxy(RescuableMock);
    await rescuableMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(rescuableMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(rescuableMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setRescuer()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(rescuableMock.connect(user).setRescuer(user.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedRescuerAddress: string = user.address;
      await proveTx(rescuableMock.setRescuer(expectedRescuerAddress));
      const actualRescuerAddress: string = await rescuableMock.getRescuer();
      expect(actualRescuerAddress).to.equal(expectedRescuerAddress);
    });

    it("Emits the correct event", async () => {
      const rescuerAddress: string = user.address;
      await expect(rescuableMock.setRescuer(rescuerAddress))
        .to.emit(rescuableMock, "RescuerChanged")
        .withArgs(rescuerAddress);
    });
  });

  describe("Function 'rescueERC20()'", async () => {
    const tokenBalance: number = 123;
    let testTokenMock: Contract;

    beforeEach(async () => {
      const ERC20Mock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
      testTokenMock = await upgrades.deployProxy(ERC20Mock, ["Test Token", "TEST"]);
      await testTokenMock.deployed();

      await proveTx(testTokenMock.mint(rescuableMock.address, tokenBalance));
      await proveTx(rescuableMock.setRescuer(user.address));
    });

    it("Is reverted if is called not by the rescuer", async () => {
      await expect(rescuableMock.rescueERC20(testTokenMock.address, user.address, tokenBalance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_RESCUER);
    });

    it("Transfers the correct amount of tokens", async () => {
      await expect(rescuableMock.connect(user).rescueERC20(testTokenMock.address, deployer.address, tokenBalance))
        .to.changeTokenBalances(testTokenMock, [rescuableMock, deployer], [-tokenBalance, tokenBalance]);
    });
  });
});
