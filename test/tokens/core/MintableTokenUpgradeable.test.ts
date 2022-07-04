import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../../test-utils/eth";

describe("Contract 'MintableTokenUpgradeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER = "MintableToken: caller is not the masterMinter";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER = "MintableToken: caller is not a minter";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED = 'Blacklistable: account is blacklisted';
  const REVERT_MESSAGE_IF_MINT_TO_ZERO_ADDRESS = 'MintableToken: mint to the zero address';
  const REVERT_MESSAGE_IF_MINT_AMOUNT_IS_NOT_GREATER_THAN_ZERO = 'MintableToken: mint amount not greater than 0';
  const REVERT_MESSAGE_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE = 'MintableToken: mint amount exceeds mintAllowance';
  const REVERT_MESSAGE_IF_BURN_AMOUNT_IS_NOT_GREATER_THAN_ZERO = 'MintableToken: burn amount not greater than 0';
  const REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE = 'MintableToken: burn amount exceeds balance';

  let token: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const Token: ContractFactory = await ethers.getContractFactory("MintableTokenUpgradeableMock");
    token = await upgrades.deployProxy(Token, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
    await token.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(token.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'updateMasterMinter()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(token.connect(user1).updateMasterMinter(deployer.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      await proveTx(token.updateMasterMinter(user1.address));
      expect(await token.masterMinter()).to.equal(user1.address);
    });

    it("Emits the correct event", async () => {
      await expect(token.updateMasterMinter(user1.address))
        .to.emit(token, "MasterMinterChanged")
        .withArgs(user1.address);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(token.updateMasterMinter(user1.address));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(token.setPauser(deployer.address));
      await proveTx(token.pause());
      await expect(token.configureMinter(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(token.configureMinter(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully if is called by the master minter", async () => {
      await proveTx(token.connect(user1).configureMinter(user2.address, mintAllowance));
      expect(await token.isMinter(user2.address)).to.equal(true);
      expect(await token.minterAllowance(user2.address)).to.equal(mintAllowance);
    });

    it("Emits the correct event", async () => {
      await expect(await token.connect(user1).configureMinter(user2.address, mintAllowance))
        .to.emit(token, "MinterConfigured")
        .withArgs(user2.address, mintAllowance);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(token.updateMasterMinter(user1.address));
      await proveTx(token.connect(user1).configureMinter(user2.address, mintAllowance));
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(token.removeMinter(user2.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully if is called by the master minter", async () => {
      expect(await token.isMinter(user2.address)).to.equal(true);
      expect(await token.minterAllowance(user2.address)).to.equal(mintAllowance);
      await proveTx(token.connect(user1).removeMinter(user2.address));
      expect(await token.isMinter(user2.address)).to.equal(false);
      expect(await token.minterAllowance(user2.address)).to.equal(0);
    });

    it("Emits the correct event", async () => {
      await expect(await token.connect(user1).removeMinter(user2.address))
        .to.emit(token, "MinterRemoved")
        .withArgs(user2.address);
    });
  });

  describe("Function 'mint()", async () => {
    const mintAllowance: number = 456;
    const mintAmount: number = 123;

    beforeEach(async () => {
      await proveTx(token.updateMasterMinter(deployer.address));
      await proveTx(token.configureMinter(deployer.address, mintAllowance));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(token.setPauser(deployer.address));
      await proveTx(token.pause());
      await expect(token.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await proveTx(token.removeMinter(deployer.address));
      await expect(token.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(token.selfBlacklist());
      await expect(token.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is blacklisted", async () => {
      await proveTx(token.connect(user1).selfBlacklist());
      await expect(token.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is zero", async () => {
      await expect(token.mint(ethers.constants.AddressZero, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_TO_ZERO_ADDRESS);
    });

    it("Is reverted if the mint amount is zero", async () => {
      await expect(token.mint(user1.address, 0))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_AMOUNT_IS_NOT_GREATER_THAN_ZERO);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      await expect(token.mint(user1.address, mintAllowance + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE);
    });

    it("Updates the token balance and the mint allowance correctly", async () => {
      const oldMintAllowance: BigNumber = await token.minterAllowance(deployer.address);
      await expect(async () => {
        await proveTx(token.mint(user1.address, mintAmount));
      }).to.changeTokenBalances(
        token,
        [user1],
        [mintAmount]
      );
      const newMintAllowance: BigNumber = await token.minterAllowance(deployer.address);
      expect(newMintAllowance).to.equal(oldMintAllowance.sub(BigNumber.from(mintAmount)));
    });

    it("Emits the correct events", async () => {
      await expect(await token.mint(user1.address, mintAmount))
        .to.emit(token, "Mint")
        .withArgs(deployer.address, user1.address, mintAmount)
        .to.emit(token, "Transfer")
        .withArgs(ethers.constants.AddressZero, user1.address, mintAmount)
    });
  });

  describe("Function 'burn()", async () => {
    const burnAmount: number = 123;

    beforeEach(async () => {
      await proveTx(token.updateMasterMinter(deployer.address));
      await proveTx(token.configureMinter(deployer.address, burnAmount));
      await proveTx(token.mint(deployer.address, burnAmount));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(token.setPauser(deployer.address));
      await proveTx(token.pause());
      await expect(token.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await proveTx(token.removeMinter(deployer.address));
      await expect(token.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(token.selfBlacklist());
      await expect(token.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the burn amount is zero", async () => {
      await expect(token.burn(0))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_IS_NOT_GREATER_THAN_ZERO);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      await expect(token.burn(burnAmount + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Updates the token balance correctly", async () => {
      await expect(async () => {
        await proveTx(token.burn(burnAmount));
      }).to.changeTokenBalances(
        token,
        [deployer],
        [-burnAmount]
      );
    });

    it("Emits the correct events", async () => {
      await expect(await token.burn(burnAmount))
        .to.emit(token, "Burn")
        .withArgs(deployer.address, burnAmount)
        .to.emit(token, "Transfer")
        .withArgs(deployer.address, ethers.constants.AddressZero, burnAmount);
    });
  });
});
