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

const TOKEN_NAME = "BRL Coin";
const TOKEN_SYMBOL = "BRLC";

const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";

const REVERT_ERROR_ZERO_ADDRESS = "ZeroAddress";
const REVERT_ERROR_ZERO_AMOUNT = "ZeroAmount";
const REVERT_ERROR_ZERO_PURPOSE = "ZeroPurpose";
const REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER = "UnauthorizedBlocklister";
const REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT = "TransferExceededRestrictedAmount";
const REVERT_ERROR_OBSOLATE = "Obsolate";
const REVERT_ERROR_INVALID_ID = "InvalidId";
const REVERT_ERROR_ZERO_ID = "ZeroId";

const PURPOSE_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
const PURPOSE_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
const PURPOSE_2 = "0x0000000000000000000000000000000000000000000000000000000000000002";
const PURPOSE_3 = "0x0000000000000000000000000000000000000000000000000000000000000003";
const OBSOLETE_ADDRESS = "0x3181Ab023a4D4788754258BE5A3b8cf3D8276B98";
const OBSOLETE_ID =
  ethers.getBytes(ethers.hexlify("0xfb3d7b70219de002ab2965369568c7492c0ca6cde8075175e3c26888f30d5bf2"));
const ANY_ID = ethers.getBytes("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const RESTRICTION_ID = ethers.getBytes(PURPOSE_1);

const BALANCE_OF_RESTRICTED_V2_SIGNATURE = "balanceOfRestricted(address,address,bytes32)";
const RESTRICTION_INCREASE_V2_SIGNATURE =
  "restrictionIncrease(address,address,uint256,bytes32)";
const RESTRICTION_DECREASE_V2_SIGNATURE =
  "restrictionDecrease(address,address,uint256,bytes32)";

let tokenFactory: ContractFactory;
let deployer: HardhatEthersSigner;
let pauser: HardhatEthersSigner;
let blocklister: HardhatEthersSigner;
let user1: HardhatEthersSigner;
let user2: HardhatEthersSigner;
let purposeAccount1: HardhatEthersSigner;
let purposeAccount2: HardhatEthersSigner;

describe("Contract 'ERC20Restrictable'", async () => {
  before(async () => {
    [deployer, pauser, blocklister, user1, user2, purposeAccount1, purposeAccount2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20RestrictableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
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
    await proveTx(token.setMainBlocklister(blocklister.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.mainBlocklister()).to.equal(ethers.ZeroAddress);
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

      await expect(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 100, 0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await expect(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_2, 200))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_2, 200, 0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);

      await expect(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 200, 100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(400);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).restrictionIncrease(purposeAccount1.address, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionIncrease(ethers.ZeroAddress, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionIncrease(purposeAccount1.address, PURPOSE_1, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });

    it("Is reverted if the provided purpose is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionIncrease(purposeAccount1.address, PURPOSE_ZERO, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PURPOSE);
    });
  });

  describe("Function 'restrictionDecrease()'", async () => {
    it("Increase restriction and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 200));
      await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_2, 200));

      await expect(connect(token, blocklister).restrictionDecrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 100, 200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);

      await expect(connect(token, blocklister).restrictionDecrease(user1.address, PURPOSE_2, 200))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_2, 0, 200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await expect(connect(token, blocklister).restrictionDecrease(user1.address, PURPOSE_1, 100))
        .to.emit(token, "RestrictionUpdated")
        .withArgs(user1.address, PURPOSE_1, 0, 100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(0);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).restrictionDecrease(purposeAccount1.address, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionDecrease(ethers.ZeroAddress, PURPOSE_1, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionDecrease(purposeAccount1.address, PURPOSE_1, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });

    it("Is reverted if the provided purpose is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).restrictionDecrease(purposeAccount1.address, PURPOSE_ZERO, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PURPOSE);
    });
  });

  describe("Function 'balanceOfRestricted()'", async () => {
    it("Returns the correct value", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(0);

      await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(100);

      await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_2, 200));
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(200);
      expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);
    });
  });

  // describe("Restricted balance scenarios", async () => {
  //   it("Restricted tokens are transferred properly (single-purpose accounts)", async () => {
  //     const { token } = await setUpFixture(deployAndConfigureToken);
  //
  //     await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]));
  //     await proveTx(token.assignPurposes(purposeAccount2.address, [PURPOSE_2]));
  //     await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100));
  //     await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_2, 200));
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(300);
  //
  //     await proveTx(token.mint(user1.address, 300));
  //
  //     await expect(
  //       connect(token, user1).transfer(user2.address, 1)
  //     ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 101)
  //     ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount2.address, 201)
  //     ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 25)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-25, 25]
  //     );
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount2.address, 25)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount2],
  //       [-25, 25]
  //     );
  //
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(75);
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(175);
  //   });
  //
  //   it("Restricted tokens are transferred properly (multi-purpose account)", async () => {
  //     const { token } = await setUpFixture(deployAndConfigureToken);
  //
  //     await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1, PURPOSE_2]));
  //     await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100));
  //     await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_2, 100));
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_ZERO)).to.eq(200);
  //
  //     await proveTx(token.mint(user1.address, 200));
  //
  //     await expect(
  //       connect(token, user1).transfer(user2.address, 1)
  //     ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 50)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-50, 50]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(50);
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(100);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 100)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-100, 100]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(50);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 50)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-50, 50]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_2)).to.eq(0);
  //   });
  //
  //   it("Not restricted tokens are transferred properly", async () => {
  //     const { token } = await setUpFixture(deployAndConfigureToken);
  //
  //     await proveTx(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]));
  //     await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100));
  //
  //     await proveTx(token.mint(user1.address, 200));
  //
  //     await expect(
  //       connect(token, user1).transfer(user2.address, 101)
  //     ).to.be.revertedWithCustomError(
  //       token,
  //       REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT
  //     );
  //
  //     await expect(
  //       connect(token, user1).transfer(user2.address, 25)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, user2],
  //       [-25, 25]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(100);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 25)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-25, 25]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(75);
  //
  //     await expect(
  //       connect(token, user1).transfer(purposeAccount1.address, 100)
  //     ).to.changeTokenBalances(
  //       token,
  //       [user1, purposeAccount1],
  //       [-100, 100]
  //     );
  //     expect(await token.balanceOfRestricted(user1.address, PURPOSE_1)).to.eq(0);
  //   });
  // });
});

describe("Contract ERC20RestrictableV2", async () => {
  before(async () => {
    [deployer, pauser, blocklister, user1, user2, purposeAccount1, purposeAccount2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20RestrictableMockV2");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
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
    await proveTx(token.setMainBlocklister(blocklister.address));
    await proveTx(connect(token, user1).approve(blocklister.address, 1000000));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.mainBlocklister()).to.equal(ethers.ZeroAddress);
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
    it("Executes as expected", async () => {
      const { token } = await setUpFixture(deployToken);

      await expect(token.assignPurposes(purposeAccount1.address, [PURPOSE_1]))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_OBSOLATE);
    });

    it("Is reverted if caller is not the owner", async () => {
      const { token } = await setUpFixture(deployToken);

      await expect(connect(token, user1).assignPurposes(purposeAccount1.address, [PURPOSE_1]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Function 'restrictionIncrease()' V1", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      const balanceOfRestrictedBefore = await token.balanceOfRestricted(user1.address, PURPOSE_ZERO);

      await expect(connect(token, blocklister).restrictionIncrease(user1.address, OBSOLETE_ID, 100))
        .to.emit(token, "RestrictionChanged")
        .withArgs(
          user1.address,
          OBSOLETE_ADDRESS,
          ANY_ID,
          100,
          0,
          100,
          0
        );

      const balanceOfRestrictedAfter = await token.balanceOfRestricted(user1.address, PURPOSE_ZERO);

      expect(balanceOfRestrictedAfter).to.eq(balanceOfRestrictedBefore + BigInt(100));
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, user1).restrictionIncrease(user1.address, OBSOLETE_ID, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided id is not obsolete purpose", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).restrictionIncrease(user1.address, PURPOSE_1, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
    });
  });

  describe("Function 'restrictionDecrease()' V1", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, blocklister).restrictionIncrease(user1.address, OBSOLETE_ID, 100));

      const balanceOfRestrictedBefore = await token.balanceOfRestricted(user1.address, PURPOSE_ZERO);

      await expect(connect(token, blocklister).restrictionDecrease(user1.address, OBSOLETE_ID, 100))
        .to.emit(token, "RestrictionChanged")
        .withArgs(
          user1.address,
          OBSOLETE_ADDRESS,
          ANY_ID,
          0,
          100,
          0,
          100
        );

      const balanceOfRestrictedAfter = await token.balanceOfRestricted(user1.address, PURPOSE_ZERO);

      expect(balanceOfRestrictedAfter).to.eq(balanceOfRestrictedBefore - BigInt(100));
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, user1).restrictionDecrease(user1.address, OBSOLETE_ID, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided id is not obsolete purpose", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).restrictionDecrease(user1.address, PURPOSE_1, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
    });
  });

  describe("Function 'restrictionIncrease()' V2", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);

      const balanceOfRestrictedBefore =
        await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, RESTRICTION_ID);
      await expect(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, RESTRICTION_ID)
      ).to.emit(token, "RestrictionChanged")
        .withArgs(
          user1.address,
          user2.address,
          RESTRICTION_ID,
          100,
          0,
          100,
          0
        );

      const balanceOfRestrictedAfter =
        await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, RESTRICTION_ID);

      expect(balanceOfRestrictedAfter).to.eq(balanceOfRestrictedBefore + BigInt(100));
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(
        connect(token, user1)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, RESTRICTION_ID)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if 'from' address is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);

      await expect(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](ethers.ZeroAddress, user2.address, 100, RESTRICTION_ID)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the 'to' address is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);

      await expect(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, ethers.ZeroAddress, 100, RESTRICTION_ID)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the 'id' parameter is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);

      await expect(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ID);
    });

    it("Is reverted if the 'amount' parameter is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);

      await expect(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 0, RESTRICTION_ID)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });
  });

  describe("Function 'restrictionDecrease()' V2", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderBlocklister = connect(token, blocklister);
      await proveTx(
        tokenUnderBlocklister[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, RESTRICTION_ID)
      );

      const balanceOfRestrictedBefore =
        await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, RESTRICTION_ID);
      await expect(
        tokenUnderBlocklister[RESTRICTION_DECREASE_V2_SIGNATURE](user1.address, user2.address, 100, RESTRICTION_ID)
      ).to.emit(token, "RestrictionChanged")
        .withArgs(
          user1.address,
          user2.address,
          RESTRICTION_ID,
          0,
          100,
          0,
          100
        );

      const balanceOfRestrictedAfter =
        await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, RESTRICTION_ID);

      expect(balanceOfRestrictedAfter).to.eq(balanceOfRestrictedBefore - BigInt(100));
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(
        connect(token, user1)[RESTRICTION_DECREASE_V2_SIGNATURE](user1.address, user2.address, 100, RESTRICTION_ID)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });
  });

  describe("Function 'migrateBalance()'", async () => {
    it("Executes as expected", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mockRestrictedPurposeBalances(user1.address, OBSOLETE_ID, 100));

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(user1.address, OBSOLETE_ADDRESS));

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, OBSOLETE_ADDRESS, ANY_ID)).to.eq(100);
    });

    it("Executes as expected if 'to' address is not obsolete", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mockRestrictedPurposeBalances(user1.address, OBSOLETE_ID, 100));

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(user1.address, user2.address));

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);
    });

    it("Executes as expected if obsolete amount is zeo", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(user1.address, OBSOLETE_ADDRESS));

      expect(await token.balanceOfRestricted(user1.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, OBSOLETE_ADDRESS, ANY_ID)).to.eq(0);
    });
  });

  describe("Function 'transferRestricted()'", async () => {
    it("Executes as expected and emits correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(user1.address, 100));
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, PURPOSE_1)
      );

      const tx = await connect(token, blocklister).transferRestricted(user1.address, user2.address, 100, PURPOSE_1);
      await expect(tx).to.emit(token, "RestrictionChanged");

      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2],
        [-100, 100]
      );

      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);
    });

    it("Executes as expected if the amount is bigger than restricted to id", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(user1.address, 200));
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, PURPOSE_1)
      );

      const tx = await connect(token, blocklister).transferRestricted(user1.address, user2.address, 100, PURPOSE_1);

      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2],
        [-100, 100]
      );

      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);
    });

    it("Executes as expected if using restriction to any id and restriction is partially covered by specific and any id", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(user1.address, 150));
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 50, PURPOSE_1)
      );
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 100, ANY_ID)
      );

      const tx = await connect(token, blocklister).transferRestricted(user1.address, user2.address, 80, PURPOSE_1);

      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2],
        [-80, 80]
      );

      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(70);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, PURPOSE_1)).to.eq(0);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(token.transferRestricted(user1.address, user2.address, 100, ANY_ID))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the 'from' address or the 'to' address is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).transferRestricted(ethers.ZeroAddress, user2.address, 100, ANY_ID))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);

      await expect(connect(token, blocklister).transferRestricted(user1.address, ethers.ZeroAddress, 100, ANY_ID))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the 'id' is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).transferRestricted(user1.address, user2.address, 100, ethers.ZeroHash))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ID);
    });

    it("Is reverted if the 'id' is ANY_ID marker", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).transferRestricted(user1.address, user2.address, 100, ANY_ID))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
    });
  });

  describe("Restricted scenarios", async () => {
    it("Allows default transfer if the amount does not affect restricted balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(user1.address, 100));
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 50, PURPOSE_1)
      );
      await expect(connect(token, user1).transfer(user2.address, 50))
        .to.changeTokenBalances(
          token,
          [user1, user2],
          [-50, 50]
        );

      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(50);
    });

    it("Allows only 'transferRestricted' if the amount uses the restricted balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(user1.address, 100));
      await proveTx(
        connect(token, blocklister)[RESTRICTION_INCREASE_V2_SIGNATURE](user1.address, user2.address, 50, PURPOSE_1)
      );

      await expect(connect(token, user1).transfer(user2.address, 80))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(50);

      await expect(connect(token, blocklister).transferRestricted(user1.address, user2.address, 80, PURPOSE_1))
        .to.changeTokenBalances(
          token,
          [user1, user2],
          [-80, 80]
        );

      expect(await token[BALANCE_OF_RESTRICTED_V2_SIGNATURE](user1.address, user2.address, ANY_ID)).to.eq(0);
    });
  });
});
