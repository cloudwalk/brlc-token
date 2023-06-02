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
  const EVENT_NAME_SET_BRIDGE = "SetBridge";
  const EVENT_NAME_FREEZE_APPROVAL = "FreezeApproval";
  const EVENT_NAME_FREEZE = "Freeze";
  const EVENT_NAME_FREEZE_TRANSFER = "FreezeTransfer";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE = "ERC20: burn amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS = "ERC20: burn from the zero address";
  const REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";

  const REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroBurnForBridgingAmount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE = "UnauthorizedBridge";
  const REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO = "ZeroMintForBridgingAmount";
  const REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER = "UnauthorizedBlacklister";
  const REVERT_ERROR_IF_FREEZING_NOT_APPROVED = "FreezingNotApproved";
  const REVERT_ERROR_IF_FREEZING_ALREADY_APPROVED = "FreezingAlreadyApproved";
  const REVERT_ERROR_IF_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_IF_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";


  let brlcTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let pauser: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let bridge: SignerWithAddress;
  let newBridge: SignerWithAddress;

  before(async () => {
    [deployer, blacklister, pauser, user1, user2, bridge, newBridge] = await ethers.getSigners();
    brlcTokenFactory = await ethers.getContractFactory("BRLCTokenBridgeable");
  });

  async function deployBrlcToken(): Promise<{ brlcToken: Contract }> {
    const brlcToken: Contract = await upgrades.deployProxy(
      brlcTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL, bridge.address]
    );
    await brlcToken.deployed();
    return { brlcToken };
  }

  async function deployAndConfigureBrlcToken(): Promise<{ brlcToken: Contract }> {
    const { brlcToken } = await deployBrlcToken();
    await proveTx(brlcToken.setPauser(pauser.address));
    await proveTx(brlcToken.setBlacklister(blacklister.address));
    return { brlcToken };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
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
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
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
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, bridge, brlcToken, user1],
        [0, 0, 0, +TOKEN_AMOUNT]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_MINT_FOR_BRIDGING
      ).withArgs(
        user1.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if it is called not by the bridge", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.mintForBridging(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
    });

    it("Is reverted if it is called to mint for the zero address", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).mintForBridging(ethers.constants.AddressZero, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_FOR_ZERO_ADDRESS);
    });

    it("Is reverted if the token minting amount is zero", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).mintForBridging(user1.address, 0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_MINT_FOR_BRIDGING_AMOUNT_IS_ZERO);
    });
  });

  describe("Function 'burnForBridging()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));

      await expect(
        brlcToken.connect(bridge).burnForBridging(user1.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, bridge, brlcToken, user1],
        [0, 0, 0, -TOKEN_AMOUNT]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_BURN_FOR_BRIDGING
      ).withArgs(
        user1.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if it is called not by the bridge", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.burnForBridging(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BRIDGE);
    });

    it("Is reverted if it is called to burn from the zero address", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).burnForBridging(ethers.constants.AddressZero, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_FROM_ZERO_ADDRESS);
    });

    it("Is reverted if it is called to burn more tokens than the bridge balance", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).burnForBridging(user1.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_AMOUNT_EXCEEDS_THE_BRIDGE_BALANCE);
    });

    it("Is reverted if the token burning amount is zero", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      await expect(
        brlcToken.connect(bridge).burnForBridging(user1.address, 0)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_BURN_FOR_BRIDGING_AMOUNT_IS_ZERO);
    });
  });

  describe("Function 'setBridge()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      expect(await brlcToken.bridge()).to.eq(bridge.address);

      await expect(brlcToken.setBridge(newBridge.address))
        .to.emit(brlcToken, EVENT_NAME_SET_BRIDGE)
        .withArgs(newBridge.address, bridge.address);

      expect(await brlcToken.bridge()).to.eq(newBridge.address);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { brlcToken } = await setUpFixture(deployBrlcToken);
      expect(await brlcToken.bridge()).to.eq(bridge.address);

      await expect(brlcToken.connect(user1).setBridge(newBridge.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'approveFreezing()'", async () => {
    it("Approves freezing and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      expect(await brlcToken.freezeApproval(user1.address)).to.eq(false);
      await expect(brlcToken.connect(user1).approveFreezing())
        .to.emit(brlcToken, EVENT_NAME_FREEZE_APPROVAL).withArgs(user1.address);
      expect(await brlcToken.freezeApproval(user1.address)).to.eq(true);
    });

    it("Is reverted if freezing is already approved", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await expect(brlcToken.connect(user1).approveFreezing());
      await expect(brlcToken.connect(user1).approveFreezing())
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_FREEZING_ALREADY_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(pauser).pause());
      await expect(brlcToken.connect(user1).approveFreezing())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Freezes tokens and emits the correct events", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(user1).approveFreezing());

      expect(await brlcToken.balanceOf(user1.address)).to.eq(ethers.constants.Zero);

      await expect(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.emit(brlcToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await brlcToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT);

      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      expect(await brlcToken.balanceOf(user1.address)).to.eq(TOKEN_AMOUNT);

      await expect(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT + 1))
        .to.emit(brlcToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT + 1, TOKEN_AMOUNT);
      expect(await brlcToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT + 1);

      await expect(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT - 2))
      .to.emit(brlcToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT - 2, TOKEN_AMOUNT + 1);
      expect(await brlcToken.frozenBalance(user1.address)).to.eq(TOKEN_AMOUNT - 2);
    });

    it("Is reverted if freezing is not approved", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      expect(await brlcToken.freezeApproval(user1.address)).to.eq(false);
      await expect(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_FREEZING_NOT_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(pauser).pause());
      await expect(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a blacklister", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await expect(brlcToken.connect(user1).freeze(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });
  });

  describe("Function 'transferFrozen()'", async () => {
    it("Transfers frozen tokens and emits correct events", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(brlcToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.emit(brlcToken, EVENT_NAME_FREEZE_TRANSFER).withArgs(user1.address, TOKEN_AMOUNT)
        .to.emit(brlcToken, EVENT_NAME_FREEZE).withArgs(user1.address, TOKEN_AMOUNT, 0)
        .to.changeTokenBalances(
          brlcToken,
          [user1, user2],
          [-TOKEN_AMOUNT, TOKEN_AMOUNT]
        );
    });

    it("Is reverted if the caller is not a blacklister", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await expect(brlcToken.connect(user2).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(pauser).pause());
      await expect(brlcToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if there is a lack of frozen balance", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(brlcToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1))
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_LACK_OF_FROZEN_BALANCE);
    });

    it("Is reverted if there is a lack of common balance", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT + 1));
      await expect(brlcToken.connect(blacklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen token scenarios", async () => {
    it("Tokens above the frozen balance can be transferred successfully", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(brlcToken.connect(user1).transfer(user2.address, 1))
        .to.changeTokenBalances(
          brlcToken,
          [user1, user2],
          [-1, 1]
        );
    });

    it("Tokens below the frozen balance cannot be transferred successfully", async () => {
      const { brlcToken } = await setUpFixture(deployAndConfigureBrlcToken);
      await proveTx(brlcToken.connect(bridge).mintForBridging(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(brlcToken.connect(user1).approveFreezing());
      await proveTx(brlcToken.connect(blacklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(brlcToken.connect(user1).transfer(user2.address, 2))
        .to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });
  });
});
