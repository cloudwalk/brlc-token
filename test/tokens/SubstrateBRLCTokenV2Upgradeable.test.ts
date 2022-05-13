import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'SubstrateBRLCTokenV2Upgradeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER = "MintAndBurn: caller is not the masterMinter";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER = "MintAndBurn: caller is not a minter";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED = 'Blacklistable: account is blacklisted';
  const REVERT_MESSAGE_IF_MINT_TO_ZERO_ADDRESS = 'MintAndBurn: mint to the zero address';
  const REVERT_MESSAGE_IF_MINT_AMOUNT_IS_NOT_GREATER_THAN_ZERO = 'MintAndBurn: mint amount not greater than 0';
  const REVERT_MESSAGE_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE = 'MintAndBurn: mint amount exceeds mintAllowance';
  const REVERT_MESSAGE_IF_BURN_AMOUNT_IS_NOT_GREATER_THAN_ZERO = 'MintAndBurn: burn amount not greater than 0';
  const REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE = 'MintAndBurn: burn amount exceeds balance';

  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BrlcToken: ContractFactory = await ethers.getContractFactory("SubstrateBRLCTokenV2Upgradeable");
    brlcToken = await upgrades.deployProxy(BrlcToken, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
    await brlcToken.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'updateMasterMinter()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(brlcToken.connect(user1).updateMasterMinter(deployer.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      await proveTx(brlcToken.updateMasterMinter(user1.address));
      expect(await brlcToken.masterMinter()).to.equal(user1.address);
    });

    it("Emits the correct event", async () => {
      await expect(brlcToken.updateMasterMinter(user1.address))
        .to.emit(brlcToken, "MasterMinterChanged")
        .withArgs(user1.address);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(user1.address));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(brlcToken.configureMinter(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(brlcToken.configureMinter(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully if is called by the master minter", async () => {
      await proveTx(brlcToken.connect(user1).configureMinter(user2.address, mintAllowance));
      expect(await brlcToken.isMinter(user2.address)).to.equal(true);
      expect(await brlcToken.minterAllowance(user2.address)).to.equal(mintAllowance);
    });

    it("Emits the correct event", async () => {
      await expect(await brlcToken.connect(user1).configureMinter(user2.address, mintAllowance))
        .to.emit(brlcToken, "MinterConfigured")
        .withArgs(user2.address, mintAllowance);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    const mintAllowance: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(user1.address));
      await proveTx(brlcToken.connect(user1).configureMinter(user2.address, mintAllowance));
    });

    it("Is reverted if is called not by the master minter", async () => {
      await expect(brlcToken.removeMinter(user2.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MASTER_MINTER);
    });

    it("Executes successfully if is called by the master minter", async () => {
      expect(await brlcToken.isMinter(user2.address)).to.equal(true);
      expect(await brlcToken.minterAllowance(user2.address)).to.equal(mintAllowance);
      await proveTx(brlcToken.connect(user1).removeMinter(user2.address));
      expect(await brlcToken.isMinter(user2.address)).to.equal(false);
      expect(await brlcToken.minterAllowance(user2.address)).to.equal(0);
    });

    it("Emits the correct event", async () => {
      await expect(await brlcToken.connect(user1).removeMinter(user2.address))
        .to.emit(brlcToken, "MinterRemoved")
        .withArgs(user2.address);
    });
  });

  describe("Function 'mint()", async () => {
    const mintAllowance: number = 456;
    const mintAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(deployer.address));
      await proveTx(brlcToken.configureMinter(deployer.address, mintAllowance));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(brlcToken.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await proveTx(brlcToken.removeMinter(deployer.address));
      await expect(brlcToken.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(brlcToken.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is blacklisted", async () => {
      await proveTx(brlcToken.connect(user1).selfBlacklist());
      await expect(brlcToken.mint(user1.address, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is zero", async () => {
      await expect(brlcToken.mint(ethers.constants.AddressZero, mintAllowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_TO_ZERO_ADDRESS);
    });

    it("Is reverted if the mint amount is zero", async () => {
      await expect(brlcToken.mint(user1.address, 0))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_AMOUNT_IS_NOT_GREATER_THAN_ZERO);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      await expect(brlcToken.mint(user1.address, mintAllowance + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE);
    });

    it("Updates the token balance and the mint allowance correctly", async () => {
      const oldMintAllowance: BigNumber = await brlcToken.minterAllowance(deployer.address);
      await expect(async () => {
        await proveTx(brlcToken.mint(user1.address, mintAmount));
      }).to.changeTokenBalances(
        brlcToken,
        [user1],
        [mintAmount]
      );
      const newMintAllowance: BigNumber = await brlcToken.minterAllowance(deployer.address);
      expect(newMintAllowance).to.equal(oldMintAllowance.sub(BigNumber.from(mintAmount)));
    });

    it("Emits the correct events", async () => {
      await expect(await brlcToken.mint(user1.address, mintAmount))
        .to.emit(brlcToken, "Mint")
        .withArgs(deployer.address, user1.address, mintAmount)
        .to.emit(brlcToken, "Transfer")
        .withArgs(ethers.constants.AddressZero, user1.address, mintAmount)
    });
  });

  describe("Function 'burn()", async () => {
    const burnAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.updateMasterMinter(deployer.address));
      await proveTx(brlcToken.configureMinter(deployer.address, burnAmount));
      await proveTx(brlcToken.mint(deployer.address, burnAmount));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(brlcToken.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      await proveTx(brlcToken.removeMinter(deployer.address));
      await expect(brlcToken.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(brlcToken.burn(burnAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the burn amount is zero", async () => {
      await expect(brlcToken.burn(0))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_IS_NOT_GREATER_THAN_ZERO);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      await expect(brlcToken.burn(burnAmount + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Updates the token balance correctly", async () => {
      await expect(async () => {
        await proveTx(brlcToken.burn(burnAmount));
      }).to.changeTokenBalances(
        brlcToken,
        [deployer],
        [-burnAmount]
      );
    });

    it("Emits the correct events", async () => {
      await expect(await brlcToken.burn(burnAmount))
        .to.emit(brlcToken, "Burn")
        .withArgs(deployer.address, burnAmount)
        .to.emit(brlcToken, "Transfer")
        .withArgs(deployer.address, ethers.constants.AddressZero, burnAmount);
    });
  });
});
