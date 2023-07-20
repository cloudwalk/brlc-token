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

describe("Contract 'USJimMintable'", async () => {
  const TOKEN_NAME = "USJim Coin";
  const TOKEN_SYMBOL = "USJIM";
  const TOKEN_DECIMALS = 6;
  const MINT_ALLOWANCE = 456;
  const TOKEN_AMOUNT = 123;

  const EVENT_NAME_BURN = "Burn";
  const EVENT_NAME_MASTER_MINTER_CHANGED = "MasterMinterChanged";
  const EVENT_NAME_MINT = "Mint";
  const EVENT_NAME_MINTER_CONFIGURED = "MinterConfigured";
  const EVENT_NAME_MINTER_REMOVED = "MinterRemoved";
  const EVENT_NAME_TRANSFER = "Transfer";
  const EVENT_NAME_FREEZE_APPROVAL = "FreezeApproval";
  const EVENT_NAME_FREEZE = "Freeze";
  const EVENT_NAME_FREEZE_TRANSFER = "FreezeTransfer";

  const REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT = "ERC20: mint to the zero address";

  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER = "UnauthorizedBlacklister";
  const REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO = "ZeroBurnAmount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER = "UnauthorizedMasterMinter";
  const REVERT_ERROR_IF_CALLER_IS_NOT_MINTER = "UnauthorizedMinter";
  const REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO = "ZeroMintAmount";
  const REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE = "ExceededMintAllowance";
  const REVERT_ERROR_IF_FREEZING_NOT_APPROVED = "FreezingNotApproved";
  const REVERT_ERROR_IF_FREEZING_ALREADY_APPROVED = "FreezingAlreadyApproved";
  const REVERT_ERROR_IF_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_IF_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";

  let usjimTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let masterMinter: SignerWithAddress;
  let minter: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let pauser: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  before(async () => {
    [deployer, masterMinter, minter, blacklister, pauser, user1, user2] = await ethers.getSigners();
    usjimTokenFactory = await ethers.getContractFactory("USJimMintable");
  });

  async function deployUSJimToken(): Promise<{ usjimToken: Contract }> {
    const usjimToken: Contract = await upgrades.deployProxy(
      usjimTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL]
    );
    await usjimToken.deployed();
    return { usjimToken };
  }

  async function deployAndConfigureUSJimToken(): Promise<{ usjimToken: Contract }> {
    const { usjimToken } = await deployUSJimToken();
    await proveTx(usjimToken.setPauser(pauser.address));
    await proveTx(usjimToken.setBlacklister(blacklister.address));
    await proveTx(usjimToken.updateMasterMinter(masterMinter.address));
    await proveTx(usjimToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE));
    return { usjimToken };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      expect(await usjimToken.owner()).to.equal(deployer.address);
      expect(await usjimToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await usjimToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await usjimToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await usjimToken.masterMinter()).to.equal(ethers.constants.AddressZero);
      expect(await usjimToken.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it("Is reverted if it is called a second time", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await expect(
        usjimToken.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const usjimTokenImplementation: Contract = await usjimTokenFactory.deploy();
      await usjimTokenImplementation.deployed();

      await expect(
        usjimTokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'updateMasterMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await expect(
        usjimToken.updateMasterMinter(masterMinter.address)
      ).to.emit(
        usjimToken,
        EVENT_NAME_MASTER_MINTER_CHANGED
      ).withArgs(masterMinter.address);
      expect(await usjimToken.masterMinter()).to.equal(masterMinter.address);

      // The second call with the same argument should not emit an event
      await expect(
        usjimToken.updateMasterMinter(masterMinter.address)
      ).not.to.emit(usjimToken, EVENT_NAME_MASTER_MINTER_CHANGED);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await expect(
        usjimToken.connect(masterMinter).updateMasterMinter(masterMinter.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await proveTx(usjimToken.updateMasterMinter(masterMinter.address));
      expect(await usjimToken.isMinter(minter.address)).to.equal(false);
      expect(await usjimToken.minterAllowance(minter.address)).to.equal(0);

      await expect(
        usjimToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.emit(
        usjimToken,
        EVENT_NAME_MINTER_CONFIGURED
      ).withArgs(minter.address, MINT_ALLOWANCE);

      expect(await usjimToken.isMinter(minter.address)).to.equal(true);
      expect(await usjimToken.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await proveTx(usjimToken.setPauser(deployer.address));
      await proveTx(usjimToken.pause());

      await expect(
        usjimToken.connect(masterMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if it is called not by the master minter", async () => {
      const { usjimToken } = await setUpFixture(deployUSJimToken);
      await expect(
        usjimToken.configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      expect(await usjimToken.isMinter(minter.address)).to.equal(true);
      expect(await usjimToken.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);

      await expect(
        usjimToken.connect(masterMinter).removeMinter(minter.address)
      ).to.emit(
        usjimToken,
        EVENT_NAME_MINTER_REMOVED
      ).withArgs(minter.address);

      expect(await usjimToken.isMinter(minter.address)).to.equal(false);
      expect(await usjimToken.minterAllowance(minter.address)).to.equal(0);

      // The second call with the same argument should not emit an event
      await expect(
        usjimToken.connect(masterMinter).removeMinter(minter.address)
      ).not.to.emit(usjimToken, EVENT_NAME_MINTER_REMOVED);
    });

    it("Is reverted if it is called not by the master minter", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.removeMinter(minter.address)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_MASTER_MINTER);
    });
  });

  describe("Function 'mint()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      const oldMintAllowance: BigNumber = await usjimToken.minterAllowance(minter.address);
      const newExpectedMintAllowance: BigNumber = oldMintAllowance.sub(BigNumber.from(TOKEN_AMOUNT));

      const tx: TransactionResponse = await usjimToken.connect(minter).mint(deployer.address, TOKEN_AMOUNT);

      await expect(tx).to.emit(usjimToken, EVENT_NAME_MINT).withArgs(minter.address, deployer.address, TOKEN_AMOUNT);
      await expect(tx).to.emit(usjimToken, EVENT_NAME_TRANSFER).withArgs(
        ethers.constants.AddressZero, deployer.address, TOKEN_AMOUNT
      );
      await expect(tx).to.changeTokenBalances(
        usjimToken,
        [deployer, minter, masterMinter, usjimToken],
        [TOKEN_AMOUNT, 0, 0, 0]
      );
      expect(await usjimToken.minterAllowance(minter.address)).to.equal(newExpectedMintAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.setPauser(deployer.address));
      await proveTx(usjimToken.pause());
      await expect(
        usjimToken.connect(minter).mint(deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.mint(deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).selfBlacklist());
      await expect(
        usjimToken.connect(minter).mint(deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is blacklisted", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(deployer).selfBlacklist());
      await expect(
        usjimToken.connect(minter).mint(deployer.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the destination address is zero", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.connect(minter).mint(ethers.constants.AddressZero, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_MINT_TO_ZERO_ACCOUNT);
    });

    it("Is reverted if the mint amount is zero", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.connect(minter).mint(deployer.address, 0)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_MINT_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.connect(minter).mint(deployer.address, MINT_ALLOWANCE + 1)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_MINT_AMOUNT_EXCEEDS_ALLOWANCE);
    });
  });

  describe("Function 'burn()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(minter.address, TOKEN_AMOUNT));

      const tx: TransactionResponse = await usjimToken.connect(minter).burn(TOKEN_AMOUNT);

      await expect(tx).to.emit(usjimToken, EVENT_NAME_BURN).withArgs(minter.address, TOKEN_AMOUNT);
      await expect(tx).to.emit(usjimToken, EVENT_NAME_TRANSFER).withArgs(
        minter.address, ethers.constants.AddressZero, TOKEN_AMOUNT
      );
      await expect(tx).to.changeTokenBalances(
        usjimToken,
        [minter, masterMinter, deployer, usjimToken],
        [-TOKEN_AMOUNT, 0, 0, 0]
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.setPauser(deployer.address));
      await proveTx(usjimToken.pause());

      await expect(
        usjimToken.connect(minter).burn(TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.burn(TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_MINTER);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).selfBlacklist());
      await expect(
        usjimToken.connect(minter).burn(TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(
        usjimToken.connect(minter).burn(0)
      ).to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_BURN_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(usjimToken.connect(minter).burn(TOKEN_AMOUNT + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_BURN_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'approveFreezing()'", async () => {
    it("Approves freezing and emits the correct event", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      expect(await usjimToken.freezeApproval(user1.address)).to.eq(false);
      await expect(usjimToken.connect(user1).approveFreezing())
        .to.emit(usjimToken, EVENT_NAME_FREEZE_APPROVAL).withArgs(user1.address);
      expect(await usjimToken.freezeApproval(user1.address)).to.eq(true);
    });

    it("Is reverted if freezing is already approved", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(usjimToken.connect(user1).approveFreezing());
      await expect(usjimToken.connect(user1).approveFreezing())
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_FREEZING_ALREADY_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(pauser).pause());
      await expect(usjimToken.connect(user1).approveFreezing())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Freezes tokens and emits the correct events", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(user1).approveFreezing());

      expect(await usjimToken.balanceOf(user1.address)).to.eq(ethers.constants.Zero);

      await expect(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.emit(usjimToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await usjimToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT);

      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      expect(await usjimToken.balanceOf(user1.address)).to.eq(TOKEN_AMOUNT);

      await expect(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT + 1))
        .to.emit(usjimToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT + 1, TOKEN_AMOUNT);
      expect(await usjimToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT + 1);

      await expect(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT - 2))
      .to.emit(usjimToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT - 2, TOKEN_AMOUNT + 1);
      expect(await usjimToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT - 2);
    });

    it("Is reverted if freezing is not approved", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      expect(await usjimToken.freezeApproval(user1.address)).to.eq(false);
      await expect(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_FREEZING_NOT_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(pauser).pause());
      await expect(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a blacklister", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await expect(usjimToken.connect(user1).freeze(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });
  });

  describe("Function 'transferFrozen()'", async () => {
    it("Transfers frozen tokens and emits correct events", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(usjimToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.emit(usjimToken, EVENT_NAME_FREEZE_TRANSFER).withArgs(user1.address, TOKEN_AMOUNT)
        .to.emit(usjimToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT, 0)
        .to.changeTokenBalances(
          usjimToken,
          [user1, user2],
          [-TOKEN_AMOUNT, TOKEN_AMOUNT]
        );
    });

    it("Is reverted if the caller is not a blacklister", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await expect(usjimToken.connect(user2).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Is reverted if the contract is paused", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(pauser).pause());
      await expect(usjimToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if there is a lack of frozen balance", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(usjimToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1))
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_LACK_OF_FROZEN_BALANCE);
    });

    it("Is reverted if there is a lack of common balance", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT + 1));
      await expect(usjimToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen token scenarios", async () => {
    it("Tokens above the frozen balance can be transferred successfully", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(usjimToken.connect(user1).transfer(user2.address, 1))
        .to.changeTokenBalances(
          usjimToken,
          [user1, user2],
          [-1, 1]
        );
    });

    it("Tokens below the frozen balance cannot be transferred successfully", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      await proveTx(usjimToken.connect(minter).mint(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(usjimToken.connect(user1).approveFreezing());
      await proveTx(usjimToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(usjimToken.connect(user1).transfer(user2.address, 2))
        .to.be.revertedWithCustomError(usjimToken, REVERT_ERROR_IF_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });
  });

  describe("Function 'isUSJim()'", async () => {
    it("Returns true", async () => {
      const { usjimToken } = await setUpFixture(deployAndConfigureUSJimToken);
      expect(await usjimToken.isUSJim()).to.eq(true);
    });
  });
});
