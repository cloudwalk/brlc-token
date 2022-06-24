import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'SubstrateBRLCTokenV3Upgradeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_BRIDGE = "Bridgeable: caller is not the bridge";
  const REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS = "Bridgeable: minting for the zero address";
  const REVERT_MESSAGE_IF_MINTING_AMOUNT_IS_ZERO = "Bridgeable: minting amount is not greater than 0";
  const REVERT_MESSAGE_IF_BURNING_AMOUNT_IS_ZERO = "Bridgeable: burning amount is not greater than 0";
  const REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE =
    "Bridgeable: burning amount exceeds the bridge balance";

  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BrlcToken: ContractFactory = await ethers.getContractFactory("SubstrateBRLCTokenV3Upgradeable");
    brlcToken = await upgrades.deployProxy(BrlcToken, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
    await brlcToken.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Configuration", async () => {
    describe("Function 'setBridge()'", async () => {
      it("Is reverted if is called not by the owner", async () => {
        await expect(
          brlcToken.connect(user1).setBridge(user1.address)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Sets the bridge address correctly", async () => {
        expect(await brlcToken.bridge()).to.equal(ethers.constants.AddressZero);
        await proveTx(brlcToken.setBridge(user1.address));
        expect(await brlcToken.bridge()).to.equal(user1.address);
      })
    });
  });

  describe("Interactions related to the bridge operations", async () => {
    const tokenAmount: number = 123;
    let bridge: SignerWithAddress;
    let client: SignerWithAddress;

    beforeEach(async () => {
      bridge = user1;
      client = user2;
      await proveTx(brlcToken.setBridge(bridge.address));
    })

    describe("Function 'mintForBridging()'", async () => {
      it("Is reverted if is called not by the bridge", async () => {
        await expect(
          brlcToken.mintForBridging(client.address, tokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_BRIDGE);
      });

      it("Is reverted if is called to mint for the zero address", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(ethers.constants.AddressZero, tokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS);
      });

      it("Is reverted if is called to mint zero amount of tokens", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(client.address, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_AMOUNT_IS_ZERO);
      });

      it("Mints tokens as expected and emits the correct event", async () => {
        await expect(
          brlcToken.connect(bridge).mintForBridging(client.address, tokenAmount)
        ).to.changeTokenBalances(
          brlcToken,
          [deployer, bridge, brlcToken, client],
          [0, 0, 0, +tokenAmount]
        ).and.to.emit(
          brlcToken,
          "MintForBridging"
        ).withArgs(
          client.address,
          tokenAmount
        );
      })
    });

    describe("Function 'burnForBridging()'", async () => {

      beforeEach(async () => {
        await proveTx(brlcToken.connect(bridge).mintForBridging(bridge.address, tokenAmount));
      })

      it("Is reverted if is called not by the bridge", async () => {
        await expect(
          brlcToken.burnForBridging(client.address, tokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_BRIDGE);
      });

      it("Is reverted if is called to burn zero amount of tokens", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(client.address, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_AMOUNT_IS_ZERO);
      });

      it("Is reverted if is called to burn more tokens than the bridge balance", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(client.address, tokenAmount + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE);
      });

      it("Burns tokens as expected and emits the correct event", async () => {
        await expect(
          brlcToken.connect(bridge).burnForBridging(client.address, tokenAmount)
        ).to.changeTokenBalances(
          brlcToken,
          [deployer, bridge, brlcToken, client],
          [0, -tokenAmount, 0, 0]
        ).and.to.emit(
          brlcToken,
          "BurnForBridging"
        ).withArgs(
          client.address,
          tokenAmount
        );
      })
    });
  });
});
