import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx, connect } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20Bridgeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const TOKEN_AMOUNT = 100;

  const EVENT_NAME_SET_BRIDGE = "SetBridge";
  const EVENT_NAME_BURN_FOR_BRIDGING = "BurnForBridging";
  const EVENT_NAME_MINT_FOR_BRIDGING = "MintForBridging";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ADDRESS = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_ERC20_BURN_FROM_THE_ZERO_ADDRESS = "ERC20: burn from the zero address";
  const REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

  const REVERT_ERROR_UNAUTHORIZED_BRIDGE = "UnauthorizedBridge";
  const REVERT_ERROR_ZERO_MINT_FOR_BRIDGING_AMOUNT = "ZeroMintForBridgingAmount";
  const REVERT_ERROR_ZERO_BURN_FOR_BRIDGING_AMOUNT = "ZeroBurnForBridgingAmount";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let bridge1: HardhatEthersSigner;
  let bridge2: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, bridge1, bridge2, user] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20BridgeableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL, bridge1.address]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.bridge()).to.equal(bridge1.address);
      expect(await token.isIERC20Bridgeable()).to.equal(true);
      expect(await token.isBridgeSupported(bridge1.address)).to.equal(true);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge1.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy() as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge1.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge1.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained(bridge1.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'mintForBridging()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      const tx = connect(token, bridge1).mintForBridging(user.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [deployer, bridge1, token, user],
        [0, 0, 0, +TOKEN_AMOUNT]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_MINT_FOR_BRIDGING)
        .withArgs(user.address, TOKEN_AMOUNT);
    });

    it("Is reverted if called not by the bridge", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, user).mintForBridging(user.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BRIDGE);
    });

    it("Is reverted if called to mint for the zero address", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, bridge1).mintForBridging(ethers.ZeroAddress, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ADDRESS);
    });

    it("Is reverted if the token minting amount is zero", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, bridge1).mintForBridging(user.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_MINT_FOR_BRIDGING_AMOUNT);
    });
  });

  describe("Function 'burnForBridging()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, bridge1).mintForBridging(user.address, TOKEN_AMOUNT));
      const tx = connect(token, bridge1).burnForBridging(user.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [deployer, bridge1, token, user],
        [0, 0, 0, -TOKEN_AMOUNT]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_BURN_FOR_BRIDGING)
        .withArgs(user.address, TOKEN_AMOUNT);
    });

    it("Is reverted if called not by the bridge", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, bridge1).mintForBridging(user.address, TOKEN_AMOUNT));
      await expect(
        connect(token, user).burnForBridging(user.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BRIDGE);
    });

    it("Is reverted if called to burn from the zero address", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, bridge1).burnForBridging(ethers.ZeroAddress, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_FROM_THE_ZERO_ADDRESS);
    });

    it("Is reverted if called to burn more tokens than the bridge balance", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, bridge1).burnForBridging(user.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Is reverted if the token burning amount is zero", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, bridge1).burnForBridging(user.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_BURN_FOR_BRIDGING_AMOUNT);
    });
  });

  describe("Function 'setBridge()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.bridge()).to.eq(bridge1.address);
      await expect(token.setBridge(bridge2.address))
        .to.emit(token, EVENT_NAME_SET_BRIDGE)
        .withArgs(bridge2.address, bridge1.address);
      expect(await token.bridge()).to.eq(bridge2.address);
    });

    it("Is reverted if called not by the owner", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.bridge()).to.eq(bridge1.address);
      await expect(
        connect(token, user).setBridge(bridge2.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });
});
