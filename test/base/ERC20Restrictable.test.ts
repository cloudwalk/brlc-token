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

describe("Contract 'ERC20Restrictable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";

  const REVERT_ERROR_ZERO_ADDRESS = "ZeroAddress";
  const REVERT_ERROR_ZERO_AMOUNT = "ZeroAmount";
  const REVERT_ERROR_ZERO_PURPOSE = "ZeroPurpose";

  const PURPOSE_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const PURPOSE_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const PURPOSE_2 = "0x0000000000000000000000000000000000000000000000000000000000000002";
  const PURPOSE_3 = "0x0000000000000000000000000000000000000000000000000000000000000003";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let restrictor: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let purposeAccount1: HardhatEthersSigner;
  let purposeAccount2: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, restrictor, user1, user2, purposeAccount1, purposeAccount2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20RestrictableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account

    // For now the restrictor is the same as owner, but a separate account is used for future possible changes
    restrictor = deployer;
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy() as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'assignPurposes()'", async () => {
    it("Assigns purposes and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);

      expect(await token.assignedPurposes(purposeAccount1.address)).to.deep.equal([]);

      await expect(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]))
        .to.emit(token, "PurposesAssigned")
        .withArgs(purposeAccount1.address, [PURPOSE_1], []);
      expect(await token.assignedPurposes(purposeAccount1.address)).to.deep.equal([PURPOSE_1]);

      await expect(token.assignPurposes(purposeAccount1.address, [PURPOSE_2, PURPOSE_3]))
        .to.emit(token, "PurposesAssigned")
        .withArgs(purposeAccount1.address, [PURPOSE_2, PURPOSE_3], [PURPOSE_1]);
      expect(await token.assignedPurposes(purposeAccount1.address)).to.deep.equal([PURPOSE_2, PURPOSE_3]);

      await expect(token.assignPurposes(purposeAccount1.address, []))
        .to.emit(token, "PurposesAssigned")
        .withArgs(purposeAccount1.address, [], [PURPOSE_2, PURPOSE_3]);
      expect(await token.assignedPurposes(purposeAccount1.address)).to.deep.equal([]);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, user1).assignPurposes(purposeAccount1.address, [PURPOSE_1])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Is reverted if zero purpose is assigned", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.assignPurposes(purposeAccount1.address, [PURPOSE_1, PURPOSE_ZERO])
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PURPOSE);
    });
  });

  describe("Function 'restrictionIncrease()'", async () => {
    it("Increase restriction and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);

      await expect(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 100, 0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await expect(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_2, 200))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_2, 200, 0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);

      await expect(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 200, 100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(400);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionIncrease(ethers.ZeroAddress, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionIncrease(purposeAccount1.address, PURPOSE_1, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });

    it("Is reverted if the provided purpose is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionIncrease(purposeAccount1.address, PURPOSE_ZERO, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PURPOSE);
    });
  });

  describe("Function 'restrictionDecrease()'", async () => {
    it("Increase restriction and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 200));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_2, 200));

      await expect(connect(token, restrictor).restrictionDecrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 100, 200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);

      await expect(connect(token, restrictor).restrictionDecrease(user1.address, PURPOSE_2, 200))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_2, 0, 200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await expect(connect(token, restrictor).restrictionDecrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 0, 100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(0);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionDecrease(ethers.ZeroAddress, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionDecrease(purposeAccount1.address, PURPOSE_1, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });

    it("Is reverted if the provided purpose is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, restrictor).restrictionDecrease(purposeAccount1.address, PURPOSE_ZERO, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PURPOSE);
    });
  });

  describe("Function 'balanceOfRestricted()'", async () => {
    it("Returns the correct value", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(0);

      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_2, 200));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);
    });
  });

  describe("Restricted balance scenarios", async () => {
    it("Restricted tokens are transferred properly (single-purpose accounts)", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]));
      await proveTx(token.assignPurposes(purposeAccount2.address, [PURPOSE_2]));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_2, 200));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);

      await proveTx(token.mint(user1.address, 300));

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-25, 25]
      );
      await expect(
        connect(token, user1).transfer(purposeAccount2.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount2],
        [-25, 25]
      );

      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(75);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(175);
    });

    it("Restricted tokens are transferred properly (multi-purpose account)", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1, PURPOSE_2]));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_2, 100));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(200);

      await proveTx(token.mint(user1.address, 200));

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 50)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-50, 50]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(50);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(100);

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 100)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-100, 100]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(50);

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 50)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-50, 50]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
    });

    it("Not restricted tokens are transferred properly", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100));

      await proveTx(token.mint(user1.address, 200));

      await expect(
        connect(token, user1).transfer(user2.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, user2],
        [-25, 25]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-25, 25]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(75);

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 100)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-100, 100]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
    });

    it("Tokens are transferred properly if the restricted balance is greater than the total one", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]));
      await proveTx(connect(token, restrictor).restrictionIncrease(user1.address, PURPOSE_1, 100));

      await proveTx(token.mint(user1.address, 50));

      await expect(
        connect(token, user1).transfer(user2.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, user2],
        [-25, 25]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);

      await expect(
        connect(token, user1).transfer(purposeAccount1.address, 25)
      ).to.changeTokenBalances(
        token,
        [user1, purposeAccount1],
        [-25, 25]
      );
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(75);
    });
  });
});
