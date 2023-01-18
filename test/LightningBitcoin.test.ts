import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'LightningBitcoin'", async () => {
  const TOKEN_NAME = "Lightning Bitcoin";
  const TOKEN_SYMBOL = "lnBTC";
  const TOKEN_DECIMALS = 8;
  const MINT_ALLOWANCE = 456;
  const MINT_AMOUNT = 123;
  const BURN_AMOUNT = 123;

  const EVENT_NAME_BURN = "Burn";
  const EVENT_NAME_MASTER_MINTER_CHANGED = "MasterMinterChanged";
  const EVENT_NAME_MINT = "Mint";
  const EVENT_NAME_MINTER_CONFIGURED = "MinterConfigured";
  const EVENT_NAME_MINTER_REMOVED = "MinterRemoved";
  const EVENT_NAME_TRANSFER = "Transfer";

  const REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT = "ERC20: mint to the zero address";

  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";
  const REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO = "ZeroBurnAmount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER = "UnauthorizedMasterMinter";
  const REVERT_ERROR_IF_CALLER_IS_NOT_MINTER = "UnauthorizedMinter";
  const REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO = "ZeroMintAmount";
  const REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE = "ExceededMintAllowance";

  let lnBtcTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let masterMinter: SignerWithAddress;
  let minter: SignerWithAddress;

  before(async () => {
    [deployer, masterMinter, minter] = await ethers.getSigners();
    lnBtcTokenFactory = await ethers.getContractFactory("LightningBitcoin");
  });

  async function deployLnBtcToken(): Promise<{ lnBtcToken: Contract }> {
    const lnBtcToken: Contract = await upgrades.deployProxy(
      lnBtcTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL]
    );
    await lnBtcToken.deployed();
    return { lnBtcToken };
  }

  async function deployAndConfigureContractUnderTest(): Promise<{ lnBtcToken: Contract }> {
    const { lnBtcToken } = await deployLnBtcToken();
    await proveTx(lnBtcToken.updateMasterMinter(masterMinter.address));
    await proveTx(lnBtcToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE));
    return { lnBtcToken };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      expect(await lnBtcToken.owner()).to.equal(deployer.address);
      expect(await lnBtcToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await lnBtcToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await lnBtcToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await lnBtcToken.masterMinter()).to.equal(ethers.constants.AddressZero);
      expect(await lnBtcToken.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it("Is reverted if it is called a second time", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await expect(
        lnBtcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const lnBtcTokenImplementation: Contract = await lnBtcTokenFactory.deploy();
      await lnBtcTokenImplementation.deployed();

      await expect(
        lnBtcTokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'updateMasterMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await expect(
        lnBtcToken.updateMasterMinter(masterMinter.address)
      ).to.emit(
        lnBtcToken,
        EVENT_NAME_MASTER_MINTER_CHANGED
      ).withArgs(masterMinter.address);
      expect(await lnBtcToken.masterMinter()).to.equal(masterMinter.address);

      // The second call with the same argument should not emit an event
      await expect(
        lnBtcToken.updateMasterMinter(masterMinter.address)
      ).not.to.emit(lnBtcToken, EVENT_NAME_MASTER_MINTER_CHANGED);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await expect(
        lnBtcToken.connect(masterMinter).updateMasterMinter(masterMinter.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await proveTx(lnBtcToken.updateMasterMinter(masterMinter.address));
      expect(await lnBtcToken.isMinter(minter.address)).to.equal(false);
      expect(await lnBtcToken.minterAllowance(minter.address)).to.equal(0);

      await expect(
        lnBtcToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.emit(
        lnBtcToken,
        EVENT_NAME_MINTER_CONFIGURED
      ).withArgs(minter.address, MINT_ALLOWANCE);

      expect(await lnBtcToken.isMinter(minter.address)).to.equal(true);
      expect(await lnBtcToken.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await proveTx(lnBtcToken.setPauser(deployer.address));
      await proveTx(lnBtcToken.pause());

      await expect(
        lnBtcToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if it is called not by the master minter", async () => {
      const { lnBtcToken } = await setUpFixture(deployLnBtcToken);
      await expect(
        lnBtcToken.configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      expect(await lnBtcToken.isMinter(minter.address)).to.equal(true);
      expect(await lnBtcToken.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);

      await expect(
        lnBtcToken.connect(masterMinter).removeMinter(minter.address)
      ).to.emit(
        lnBtcToken,
        EVENT_NAME_MINTER_REMOVED
      ).withArgs(minter.address);

      expect(await lnBtcToken.isMinter(minter.address)).to.equal(false);
      expect(await lnBtcToken.minterAllowance(minter.address)).to.equal(0);

      // The second call with the same argument should not emit an event
      await expect(
        lnBtcToken.connect(masterMinter).removeMinter(minter.address)
      ).not.to.emit(lnBtcToken, EVENT_NAME_MINTER_REMOVED);
    });

    it("Is reverted if it is called not by the master minter", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.removeMinter(minter.address)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });
  });

  describe("Function 'mint()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      const oldMintAllowance: BigNumber = await lnBtcToken.minterAllowance(minter.address);
      const newExpectedMintAllowance: BigNumber = oldMintAllowance.sub(BigNumber.from(MINT_AMOUNT));

      const tx: TransactionResponse = await lnBtcToken.connect(minter).mint(deployer.address, MINT_AMOUNT);

      await expect(tx).to.emit(lnBtcToken, EVENT_NAME_MINT).withArgs(minter.address, deployer.address, MINT_AMOUNT);
      await expect(tx).to.emit(lnBtcToken, EVENT_NAME_TRANSFER).withArgs(
        ethers.constants.AddressZero, deployer.address, MINT_AMOUNT
      );
      await expect(tx).to.changeTokenBalances(
        lnBtcToken,
        [deployer, minter, masterMinter, lnBtcToken],
        [MINT_AMOUNT, 0, 0, 0]
      );
      expect(await lnBtcToken.minterAllowance(minter.address)).to.equal(newExpectedMintAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.setPauser(deployer.address));
      await proveTx(lnBtcToken.pause());
      await expect(
        lnBtcToken.connect(minter).mint(deployer.address, MINT_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.mint(deployer.address, MINT_AMOUNT)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.connect(minter).selfBlacklist());
      await expect(
        lnBtcToken.connect(minter).mint(deployer.address, MINT_AMOUNT)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is blacklisted", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.connect(deployer).selfBlacklist());
      await expect(
        lnBtcToken.connect(minter).mint(deployer.address, MINT_AMOUNT)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is zero", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.connect(minter).mint(ethers.constants.AddressZero, MINT_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT);
    });

    it("Is reverted if the mint amount is zero", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.connect(minter).mint(deployer.address, 0)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.connect(minter).mint(deployer.address, MINT_ALLOWANCE + 1)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE);
    });
  });

  describe("Function 'burn()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.connect(minter).mint(minter.address, BURN_AMOUNT));

      const tx: TransactionResponse = await lnBtcToken.connect(minter).burn(BURN_AMOUNT);

      await expect(tx).to.emit(lnBtcToken, EVENT_NAME_BURN).withArgs(minter.address, BURN_AMOUNT);
      await expect(tx).to.emit(lnBtcToken, EVENT_NAME_TRANSFER).withArgs(
        minter.address, ethers.constants.AddressZero, BURN_AMOUNT
      );
      await expect(tx).to.changeTokenBalances(
        lnBtcToken,
        [minter, masterMinter, deployer, lnBtcToken],
        [-BURN_AMOUNT, 0, 0, 0]
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.setPauser(deployer.address));
      await proveTx(lnBtcToken.pause());

      await expect(
        lnBtcToken.connect(minter).burn(BURN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.burn(BURN_AMOUNT)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await proveTx(lnBtcToken.connect(minter).selfBlacklist());
      await expect(
        lnBtcToken.connect(minter).burn(BURN_AMOUNT)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(
        lnBtcToken.connect(minter).burn(0)
      ).to.be.revertedWithCustomError(lnBtcToken, REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { lnBtcToken } = await setUpFixture(deployAndConfigureContractUnderTest);
      await expect(lnBtcToken.connect(minter).burn(BURN_AMOUNT + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE);
    });
  });
});
