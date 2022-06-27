import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'BRLCWrapperUpgradeable'", async () => {
  const WRAPPER_NAME = "BRL X Coin";
  const WRAPPER_SYMBOL = "BRLCX";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_INITIALIZED_WITH_ZERO_UNDERLYING_TOKEN_ADDRESS =
    "the address of the underlying token contract is zero";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_TOKEN_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

  let brlcWrapper: Contract;
  let brlcMock: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy BRLC mock
    const BRLCMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    brlcMock = await upgrades.deployProxy(BRLCMock, ["BRL Coin", "BRLC", 6]);
    await brlcMock.deployed();

    // Deploy the contract under test
    const BrlcWrapper: ContractFactory = await ethers.getContractFactory("BRLCWrapperUpgradeable");
    brlcWrapper = await upgrades.deployProxy(BrlcWrapper, [WRAPPER_NAME, WRAPPER_SYMBOL, brlcMock.address]);
    await brlcWrapper.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      brlcWrapper.initialize(WRAPPER_NAME, WRAPPER_SYMBOL, brlcMock.address)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize function is reverted if is called with a zero underlying token address", async () => {
    //Deploy the contract not as upgradable one
    const BrlcWrapper: ContractFactory = await ethers.getContractFactory("BRLCWrapperUpgradeable");
    brlcWrapper = await BrlcWrapper.deploy();
    await brlcWrapper.deployed();

    await expect(
      brlcWrapper.initialize(WRAPPER_NAME, WRAPPER_SYMBOL, ethers.constants.AddressZero)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_INITIALIZED_WITH_ZERO_UNDERLYING_TOKEN_ADDRESS);
  })

  describe("Function 'isIERC20Wrapper()'", async () => {
    it("Returns true if is called by the owner", async () => {
      expect(await brlcWrapper.isIERC20Wrapper()).to.equal(true);
    });
    it("Returns true if is called not by the owner", async () => {
      expect(await brlcWrapper.connect(user1).isIERC20Wrapper()).to.equal(true);
    });
  });

  describe("Function 'wrapFor()'", async () => {
    const amount = 123;

    beforeEach(async () => {
      await proveTx(brlcMock.mint(user1.address, amount));
      await proveTx(brlcMock.connect(user1).approve(brlcWrapper.address, amount));
    });

    it("Is reverted if is called not by the owner", async () => {
      await expect(
        brlcWrapper.connect(user1).wrapFor(user1.address, amount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Is reverted if the account has not enough underlying token balance", async () => {
      await expect(
        brlcWrapper.wrapFor(user1.address, amount + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfers the tokens as expected, emits the correct events", async () => {
      await expect(
        brlcWrapper.wrapFor(user1.address, amount)
      ).to.changeTokenBalances(
        brlcMock,
        [user1, brlcWrapper],
        [-amount, +amount]
      ).and.to.changeTokenBalances(
        brlcWrapper,
        [user1, brlcWrapper],
        [+amount, 0]
      ).and.to.emit(
        brlcWrapper,
        "Wrap"
      ).withArgs(
        user1.address,
        amount
      ).and.to.emit(
        brlcMock,
        "Transfer"
      ).withArgs(
        user1.address,
        brlcWrapper.address,
        amount
      ).and.to.emit(
        brlcWrapper,
        "Transfer"
      ).withArgs(
        ethers.constants.AddressZero,
        user1.address,
        amount
      );
    });
  });

  describe("Function 'unwrapFor()'", async () => {
    const amount = 123;

    beforeEach(async () => {
      await proveTx(brlcMock.mint(user1.address, amount));
      await proveTx(brlcMock.connect(user1).approve(brlcWrapper.address, amount));
      await proveTx(brlcWrapper.wrapFor(user1.address, amount));
    });

    it("Is reverted if is called not by the owner", async () => {
      await expect(
        brlcWrapper.connect(user1).unwrapFor(user1.address, amount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Is reverted if the account has not enough wrapped token balance", async () => {
      await proveTx(brlcMock.mint(brlcWrapper.address, 1));
      await expect(
        brlcWrapper.unwrapFor(user1.address, amount + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfers the tokens as expected, emits the correct events", async () => {
      await expect(
        brlcWrapper.unwrapFor(user1.address, amount)
      ).to.changeTokenBalances(
        brlcMock,
        [user1, brlcWrapper],
        [+amount, -amount]
      ).and.to.changeTokenBalances(
        brlcWrapper,
        [user1, brlcWrapper],
        [-amount, 0]
      ).and.to.emit(
        brlcWrapper,
        "Unwrap"
      ).withArgs(
        user1.address,
        amount
      ).and.to.emit(
        brlcMock,
        "Transfer"
      ).withArgs(
        brlcWrapper.address,
        user1.address,
        amount
      ).and.to.emit(
        brlcWrapper,
        "Transfer"
      ).withArgs(
        user1.address,
        ethers.constants.AddressZero,
        amount
      )
    });
  });

  describe("Function 'underlying()'", async () => {
    it("Returns the correct address of the underlying token", async () => {
      expect(await brlcWrapper.underlying()).to.equal(brlcMock.address);
    });
  });
});
