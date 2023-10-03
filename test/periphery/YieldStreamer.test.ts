import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

const ZERO_ADDRESS = ethers.constants.AddressZero;
const ZERO_BIG_NUMBER = ethers.constants.Zero;
const INIT_TOKEN_BALANCE: BigNumber = BigNumber.from(1000_000_000_000);

interface TestContext {
  tokenMock: Contract;
  balanceTrackerMock: Contract;
  yieldStreamer: Contract;
}

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}


describe("Contract 'YieldStreamer'", async () => {

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";

  const REVERT_ERROR_UNAUTHORIZED_CALLER = "UnauthorizedCaller";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT16 = "SafeCastOverflowUint16";
  const REVERT_ERROR_SAFE_CAST_OVERFLOW_UINT240 = "SafeCastOverflowUint240";
  const REVERT_ERROR_FROM_DAY_PRIOR_INIT_DAY = "FromDayPriorInitDay";
  const REVERT_ERROR_TO_DAY_PRIOR_FROM_DAY = "ToDayPriorFromDay";

  let tokenMockFactory: ContractFactory;
  let balanceTrackerMockFactory: ContractFactory;
  let yieldStreamerFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let feeReceiver: SignerWithAddress;

  before(async () => {
    [deployer, user] = await ethers.getSigners();
    tokenMockFactory = await ethers.getContractFactory("ERC20TestMock");
    balanceTrackerMockFactory = await ethers.getContractFactory("BalanceTrackerMock");
    yieldStreamerFactory = await ethers.getContractFactory("YieldStreamer");
  });

  async function deployContracts(): Promise<TestContext> {
    const tokenMock: Contract = await upgrades.deployProxy(tokenMockFactory, ["Test Token Mock", "TTM"]);
    await tokenMock.deployed();

    const balanceTrackerMock: Contract = await balanceTrackerMockFactory.deploy(tokenMock.address);
    await balanceTrackerMock.deployed();

    const yieldStreamer: Contract = await upgrades.deployProxy(yieldStreamerFactory);
    await yieldStreamer.deployed();

    return {
      tokenMock,
      balanceTrackerMock,
      yieldStreamer
    };
  }

  async function deployAndConfigureContracts(): Promise<TestContext> {
    const { tokenMock, balanceTrackerMock, yieldStreamer } = await deployContracts();

    await proveTx(yieldStreamer.setFeeReceiver(feeReceiver.address));
    await proveTx(yieldStreamer.setBalanceTracker(balanceTrackerMock.address));

    return {
      tokenMock,
      balanceTrackerMock,
      yieldStreamer
    };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      const { yieldStreamer } = context;
      expect(await yieldStreamer.owner()).to.equal(deployer.address);
      expect(await yieldStreamer.balanceTracker()).to.equal(ZERO_ADDRESS);
      expect(await yieldStreamer.feeReceiver()).to.equal(ZERO_ADDRESS);
    });

    it("Is reverted if called for the second time", async () => {
      const context: TestContext = await setUpFixture(deployContracts);
      await expect(context.yieldStreamer.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const yieldStreamerImplementation: Contract = await yieldStreamerFactory.deploy();
      await yieldStreamerImplementation.deployed();
      await expect(yieldStreamerImplementation.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });
  });
});
