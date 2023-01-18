import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
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

describe("Contract 'BRLCTokenBridgeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;
  const TOKEN_AMOUNT = 123;

  const EVENT_NAME_BURN_FOR_BRIDGING = "BurnForBridging";
  const EVENT_NAME_MINT_FOR_BRIDGING = "MintForBridging";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE = "ERC20: burn amount exceeds balance";
  const REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS = "ERC20: burn from the zero address";
  const REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS = "ERC20: mint to the zero address";

  const REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroBurnForBridgingAmount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE = "UnauthorizedBridge";
  const REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroMintForBridgingAmount";

  let brlcTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let bridge: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, bridge, user] = await ethers.getSigners();
    brlcTokenFactory = await ethers.getContractFactory("BRLCTokenBridgeable");
  });

  async function deployContractUnderTest(): Promise<{ brlcToken: Contract }> {
    const brlcToken: Contract = await upgrades.deployProxy(
      brlcTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL, bridge.address]
    );
    await brlcToken.deployed();
    return { brlcToken };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      expect(await brlcToken.owner()).to.equal(deployer.address);
      expect(await brlcToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.decimals()).to.equal(TOKEN_DECIMALS);
      expect(await brlcToken.bridge()).to.equal(bridge.address);
      expect(await brlcToken.isIERC20Bridgeable()).to.equal(true);
      expect(await brlcToken.isBridgeSupported(bridge.address)).to.equal(true);
    });

    it("Is reverted if it is called a second time", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if it is called with the zero bridge address", async () => {
      await expect(
        upgrades.deployProxy(brlcTokenFactory, [TOKEN_NAME, TOKEN_SYMBOL, ethers.constants.AddressZero])
      ).to.be.reverted;
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const brlcTokenImplementation: Contract = await brlcTokenFactory.deploy();
      await brlcTokenImplementation.deployed();

      await expect(
        brlcTokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'mintForBridging()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).mintForBridging(user.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, bridge, brlcToken, user],
        [0, 0, 0, +TOKEN_AMOUNT]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_MINT_FOR_BRIDGING
      ).withArgs(
        user.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if it is called not by the bridge", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.mintForBridging(user.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
    });

    it("Is reverted if it is called to mint for the zero address", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).mintForBridging(ethers.constants.AddressZero, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS);
    });

    it("Is reverted if the token minting amount is zero", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).mintForBridging(user.address, 0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO);
    });
  });

  describe("Function 'burnForBridging()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user.address, TOKEN_AMOUNT));

      await expect(
        brlcToken.connect(bridge).burnForBridging(user.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, bridge, brlcToken, user],
        [0, 0, 0, -TOKEN_AMOUNT]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_BURN_FOR_BRIDGING
      ).withArgs(
        user.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if it is called not by the bridge", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.burnForBridging(user.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
    });

    it("Is reverted if it is called to burn from the zero address", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).burnForBridging(ethers.constants.AddressZero, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS);
    });

    it("Is reverted if it is called to burn more tokens than the bridge balance", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).burnForBridging(user.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE);
    });

    it("Is reverted if the token burning amount is zero", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.connect(bridge).burnForBridging(user.address, 0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO);
    });
  });
});
