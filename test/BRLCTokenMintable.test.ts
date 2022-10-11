import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../test-utils/eth";

describe("Contract 'BRLCTokenMintable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

  const REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER = "UnauthorizedMasterMinter";
  const REVERT_ERROR_IF_CALLER_IS_NOT_MINTER = "UnauthorizedMinter";
  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";
  const REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO = "ZeroMintAmount";
  const REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE = "ExceededMintAllowance";
  const REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO = "ZeroBurnAmount";

  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let masterMinter: SignerWithAddress;
  let minter: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BrlcToken: ContractFactory = await ethers.getContractFactory("BRLCTokenMintable");
    brlcToken = await BrlcToken.deploy();
    await brlcToken.deployed();
    await proveTx(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL));

    // Get user accounts
    [deployer, masterMinter, minter] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initial contract configuration should be as expected", async () => {
    expect(await brlcToken.owner()).to.equal(deployer.address);
    expect(await brlcToken.pauser()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.rescuer()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.blacklister()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.masterMinter()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.decimals()).to.equal(6);
  });

  describe("Function 'updateMasterMinter()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(
        brlcToken.connect(masterMinter).updateMasterMinter(masterMinter.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully and emits the correct event if is called by the owner", async () => {
      await expect(
        brlcToken.updateMasterMinter(masterMinter.address)
      ).to.emit(
        brlcToken,
        "MasterMinterChanged"
      ).withArgs(masterMinter.address);
      expect(await brlcToken.masterMinter()).to.equal(masterMinter.address);

      // The second call with the same argument should not emit an event
      await expect(
        brlcToken.updateMasterMinter(masterMinter.address)
      ).not.to.emit(brlcToken, "MasterMinterChanged");
    });
  });

  describe("Function 'configureMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(masterMinter.address));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.connect(masterMinter).configureMinter(minter.address, mintAllowance)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(
        brlcToken.configureMinter(minter.address, mintAllowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully and emits the correct event if is called by the master minter", async () => {
      expect(await brlcToken.isMinter(minter.address)).to.equal(false);
      expect(await brlcToken.minterAllowance(minter.address)).to.equal(0);
      await expect(
        brlcToken.connect(masterMinter).configureMinter(minter.address, mintAllowance)
      ).to.emit(
        brlcToken,
        "MinterConfigured"
      ).withArgs(minter.address, mintAllowance);
      expect(await brlcToken.isMinter(minter.address)).to.equal(true);
      expect(await brlcToken.minterAllowance(minter.address)).to.equal(mintAllowance);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(masterMinter.address));
      await proveTx(brlcToken.connect(masterMinter).configureMinter(minter.address, mintAllowance));
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(
        brlcToken.removeMinter(minter.address)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully and emits the correct event if is called by the master minter", async () => {
      expect(await brlcToken.isMinter(minter.address)).to.equal(true);
      expect(await brlcToken.minterAllowance(minter.address)).to.equal(mintAllowance);
      await expect(
        brlcToken.connect(masterMinter).removeMinter(minter.address)
      ).to.emit(
        brlcToken,
        "MinterRemoved"
      ).withArgs(minter.address);
      expect(await brlcToken.isMinter(minter.address)).to.equal(false);
      expect(await brlcToken.minterAllowance(minter.address)).to.equal(0);

      // The second call with the same argument should not emit an event
      await expect(
        brlcToken.connect(masterMinter).removeMinter(minter.address)
      ).not.to.emit(brlcToken, "MinterRemoved");
    });
  });

  describe("Function 'mint()", async () => {
    const mintAllowance: number = 456;
    const mintAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(masterMinter.address));
      await proveTx(brlcToken.connect(masterMinter).configureMinter(minter.address, mintAllowance));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.connect(minter).mint(deployer.address, mintAllowance)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await expect(
        brlcToken.mint(deployer.address, mintAllowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.connect(minter).selfBlacklist());
      await expect(
        brlcToken.connect(minter).mint(deployer.address, mintAllowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is blacklisted", async () => {
      await proveTx(brlcToken.connect(deployer).selfBlacklist());
      await expect(
        brlcToken.connect(minter).mint(deployer.address, mintAllowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is zero", async () => {
      await expect(
        brlcToken.connect(minter).mint(ethers.constants.AddressZero, mintAllowance)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT);
    });

    it("Is reverted if the mint amount is zero", async () => {
      await expect(
        brlcToken.connect(minter).mint(deployer.address, 0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      await expect(
        brlcToken.connect(minter).mint(deployer.address, mintAllowance + 1)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE);
    });

    it("Updates the token balance and the mint allowance correctly, emits the correct events", async () => {
      const oldMintAllowance: BigNumber = await brlcToken.minterAllowance(minter.address);
      const newExpectedMintAllowance: BigNumber = oldMintAllowance.sub(BigNumber.from(mintAmount));
      await expect(
        brlcToken.connect(minter).mint(deployer.address, mintAmount)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, minter, masterMinter, brlcToken],
        [mintAmount, 0, 0, 0]
      ).and.to.emit(
        brlcToken,
        "Mint"
      ).withArgs(
        minter.address,
        deployer.address,
        mintAmount
      ).and.to.emit(
        brlcToken,
        "Transfer"
      ).withArgs(
        ethers.constants.AddressZero,
        deployer.address,
        mintAmount
      );
      expect(await brlcToken.minterAllowance(minter.address)).to.equal(newExpectedMintAllowance);
    });
  });

  describe("Function 'burn()", async () => {
    const burnAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(masterMinter.address));
      await proveTx(brlcToken.connect(masterMinter).configureMinter(minter.address, burnAmount));
      await proveTx(brlcToken.connect(minter).mint(minter.address, burnAmount));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.connect(minter).burn(burnAmount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await expect(
        brlcToken.burn(burnAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.connect(minter).selfBlacklist());
      await expect(
        brlcToken.connect(minter).burn(burnAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the burn amount is zero", async () => {
      await expect(
        brlcToken.connect(minter).burn(0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      await expect(brlcToken.connect(minter).burn(burnAmount + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Updates the token balance correctly and emits the correct events", async () => {
      await expect(
        brlcToken.connect(minter).burn(burnAmount)
      ).to.changeTokenBalances(
        brlcToken,
        [minter, masterMinter, deployer, brlcToken],
        [-burnAmount, 0, 0, 0]
      ).and.to.emit(
        brlcToken,
        "Burn"
      ).withArgs(
        minter.address,
        burnAmount
      ).and.to.emit(
        brlcToken,
        "Transfer"
      ).withArgs(
        minter.address,
        ethers.constants.AddressZero,
        burnAmount
      );
    });
  });
});
