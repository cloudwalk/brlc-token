import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../test-utils/eth";

describe("Contract 'BRLCTokenBridgeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS = "ERC20: burn from the zero address";
  const REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE = "ERC20: burn amount exceeds balance";

  const REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE = "UnauthorizedBridge";
  const REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroMintForBridgingAmount";
  const REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroBurnForBridgingAmount";

  let BrlcToken: ContractFactory;
  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let bridge: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    // Get user accounts
    [deployer, bridge, user] = await ethers.getSigners();

    // Deploy the contract under test
    BrlcToken = await ethers.getContractFactory("BRLCTokenBridgeable");
    brlcToken = await BrlcToken.deploy();
    await brlcToken.deployed();
  });

  describe("Initialization and configuration", async () => {

    it("The initialize function can't be called more than once", async () => {
      await proveTx(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address));
      await expect(
        brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The 'initialize()' function is reverted if called with the zero bridge address", async () => {
      await expect(
        brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, ethers.constants.AddressZero)
      ).to.be.reverted;
    });

    it("The initial contract configuration should be as expected", async () => {
      await proveTx(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address));

      expect(await brlcToken.owner()).to.equal(deployer.address);
      expect(await brlcToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.decimals()).to.equal(6);
      expect(await brlcToken.bridge()).to.equal(bridge.address);
      expect(await brlcToken.isIERC20Bridgeable()).to.equal(true);
      expect(await brlcToken.isBridgeSupported(bridge.address)).to.equal(true);
    });
  });

  describe("Interactions related to the bridge operations", async () => {
    const tokenAmount = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address));
    });

    describe("Function 'mintForBridging()'", async () => {
      it("Is reverted if is called not by the bridge", async () => {
        await expect(
          brlcToken.mintForBridging(user.address, tokenAmount)
        ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
      });

      it("Is reverted if is called to mint for the zero address", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(ethers.constants.AddressZero, tokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS);
      });

      it("Is reverted if the token minting amount is zero", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(user.address, 0)
        ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO);
      });

      it("Mints tokens as expected and emits the correct event", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(user.address, tokenAmount)
        ).to.changeTokenBalances(
          brlcToken,
          [deployer, bridge, brlcToken, user],
          [0, 0, 0, +tokenAmount]
        ).and.to.emit(
          brlcToken,
          "MintForBridging"
        ).withArgs(
          user.address,
          tokenAmount
        );
      });
    });

    describe("Function 'burnForBridging()'", async () => {

      beforeEach(async () => {
        await proveTx(brlcToken.connect(bridge).mintForBridging(user.address, tokenAmount));
      });

      it("Is reverted if is called not by the bridge", async () => {
        await expect(
          brlcToken.burnForBridging(user.address, tokenAmount)
        ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
      });

      it("Is reverted if is called to burn from the zero address", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(ethers.constants.AddressZero, tokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS);
      });

      it("Is reverted if is called to burn more tokens than the bridge balance", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(user.address, tokenAmount + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE);
      });

      it("Is reverted if the token burning amount is zero", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(user.address, 0)
        ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO);
      });

      it("Burns tokens as expected and emits the correct event", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(user.address, tokenAmount)
        ).to.changeTokenBalances(
          brlcToken,
          [deployer, bridge, brlcToken, user],
          [0, 0, 0, -tokenAmount]
        ).and.to.emit(
          brlcToken,
          "BurnForBridging"
        ).withArgs(
          user.address,
          tokenAmount
        );
      });
    });
  });
});