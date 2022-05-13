import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'WhitelistableExUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELIST_ADMIN = 'Whitelistable: caller is not the whitelist admin';

  let whitelistableExMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const WhitelistableExMock: ContractFactory = await ethers.getContractFactory("WhitelistableExUpgradeableMock");
    whitelistableExMock = await upgrades.deployProxy(WhitelistableExMock);
    await whitelistableExMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(whitelistableExMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(whitelistableExMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'updateWhitelister()'", async () => {
    beforeEach(async () => {
      await proveTx(whitelistableExMock.setWhitelistAdmin(user.address));
    });

    it("Is reverted if is called not by the whitelist admin", async () => {
      await expect(whitelistableExMock.updateWhitelister(deployer.address, true))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELIST_ADMIN);
    });

    it("Executes successfully if is called by the whitelist admin", async () => {
      expect(await whitelistableExMock.isWhitelister(deployer.address)).to.equal(false);

      await proveTx(whitelistableExMock.connect(user).updateWhitelister(deployer.address, true));
      expect(await whitelistableExMock.isWhitelister(deployer.address)).to.equal(true);

      await proveTx(whitelistableExMock.connect(user).updateWhitelister(deployer.address, false));
      expect(await whitelistableExMock.isWhitelister(deployer.address)).to.equal(false);
    });

    it("Emits the correct event", async () => {
      await expect(whitelistableExMock.connect(user).updateWhitelister(deployer.address, true))
        .to.emit(whitelistableExMock, "WhitelisterChanged")
        .withArgs(deployer.address, true);
    });
  });
});
