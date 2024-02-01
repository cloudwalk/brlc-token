import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'USJimToken' - Premintable & Freezable scenarios", async () => {
  const TOKEN_NAME = "USJim Coin";
  const TOKEN_SYMBOL = "USJIM";
  const MAX_PENDING_PREMINTS_COUNT = 5;

  const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT = "TransferExceededPremintedAmount";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";

  let tokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let reciever: SignerWithAddress;

  before(async () => {
    [deployer, user, reciever] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("USJimToken");
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.deployed();
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.connect(deployer).setMainBlocklister(deployer.address));
    await proveTx(token.connect(deployer).configureBlocklister(deployer.address, true));
    await proveTx(token.connect(deployer).updateMainMinter(deployer.address));
    await proveTx(token.connect(deployer).configureMinter(deployer.address, 50));
    await proveTx(token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    await proveTx(token.connect(user).approveFreezing());
    return { token };
  }

  describe("Frozen and premint balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });
    it("Transfer - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-5, 5]
      );
    });

    it("Transfer - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-10, 10]
      );
    });

    it("Transfer - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer - test 5 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp + 100));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 10 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp + 100));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 15 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp + 100));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 20 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp + 100));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 25 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp + 100));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen balance only, no premint balance", async () => {
    it("Transfer - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-5, 5]
      );
    });

    it("Transfer - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-10, 10]
      );
    });

    it("Transfer - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Premint balance only, no frozen balance", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = await time.latest();
    });
    it("Transfer - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-5, 5]
      );
    });

    it("Transfer - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-10, 10]
      );
    });

    it("Transfer - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-15, 15]
      );
    });

    it("Transfer - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-20, 20]
      );
    });

    it("Transfer - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await time.increaseTo(timestamp + 1);
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer - test 5 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const timestamp = (await time.latest()) + 100;
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 10 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const timestamp = (await time.latest()) + 100;
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 15 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const timestamp = (await time.latest()) + 100;
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp));
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 20 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp + 100));
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer - test 25 without release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp + 100));
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("No frozen or premint balances", async () => {
    it("Transfer - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(reciever.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-5, 5]
      );
    });

    it("Transfer - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(reciever.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-10, 10]
      );
    });

    it("Transfer - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(reciever.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-15, 15]
      );
    });

    it("Transfer - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(reciever.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, reciever],
        [-20, 20]
      );
    });

    it("Transfer - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(reciever.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });
});
