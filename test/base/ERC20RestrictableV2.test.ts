import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, proveTx } from "../../test-utils/eth";

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
const REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER = "UnauthorizedBlocklister";
const REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT = "TransferExceededRestrictedAmount";
const REVERT_ERROR_OBSOLETE = "Obsolete";
const REVERT_ERROR_INVALID_ID = "InvalidId";
const REVERT_ERROR_ZERO_ID = "ZeroId";

const PURPOSE_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
const PURPOSE_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
const OBSOLETE_ADDRESS = "0x3181Ab023a4D4788754258BE5A3b8cf3D8276B98";
const OBSOLETE_ID = "0xfb3d7b70219de002ab2965369568c7492c0ca6cde8075175e3c26888f30d5bf2";
const ANY_ID = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const ID1 = "0x0000000000000000000000000000000000000000000000000000000000000123";
const ID2 = "0x0000000000000000000000000000000000000000000000000000000000000311";
const ID_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ADDRESS_ZERO = ethers.ZeroAddress;

const FUNC_BALANCE_OF_RESTRICTED_V2 = "balanceOfRestricted(address,address,bytes32)";
const FUNC_RESTRICTION_INCREASE_V2 =
  "restrictionIncrease(address,address,uint256,bytes32)";
const FUNC_RESTRICTION_DECREASE_V2 =
  "restrictionDecrease(address,address,uint256,bytes32)";

let tokenFactory: ContractFactory;
let deployer: HardhatEthersSigner;
let pauser: HardhatEthersSigner;
let blocklister: HardhatEthersSigner;
let fromAccount: HardhatEthersSigner;
let toAccount: HardhatEthersSigner;
let purposeAccount: HardhatEthersSigner;

async function checkRestrictedBalancesV2(token: Contract, props: {
  id: string;
  expectedRestrictedBalanceSpecific: bigint;
  expectedRestrictedBalanceTotal: bigint;
  fromAddress?: string;
  toAddress?: string;
}) {
  const { id, expectedRestrictedBalanceSpecific, expectedRestrictedBalanceTotal } = props;
  const fromAddress: string = props.fromAddress ?? fromAccount.address;
  const toAddress: string = props.toAddress ?? toAccount.address;

  const specificRestrictedBalance = await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAddress, toAddress, id);
  const totalRestrictedBalance1 = await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAddress, ADDRESS_ZERO, id);
  const totalRestrictedBalance2 = await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAddress, toAddress, ID_ZERO);

  expect(specificRestrictedBalance).to.eq(expectedRestrictedBalanceSpecific);
  expect(totalRestrictedBalance1).to.eq(expectedRestrictedBalanceTotal);
  expect(totalRestrictedBalance2).to.eq(expectedRestrictedBalanceTotal);
}

describe("Contract ERC20RestrictableV2", async () => {
  before(async () => {
    [deployer, pauser, blocklister, fromAccount, toAccount, purposeAccount] = await ethers.getSigners();
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
    await proveTx(connect(token, fromAccount).approve(blocklister.address, 1000000));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ADDRESS_ZERO);
      expect(await token.mainBlocklister()).to.equal(ADDRESS_ZERO);

      // Check public constants
      expect(await token.ANY_ID()).to.equal(ANY_ID);
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

      await expect(token.assignPurposes(purposeAccount.address, [PURPOSE_1]))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_OBSOLETE);
    });

    it("Is reverted if caller is not the owner", async () => {
      const { token } = await setUpFixture(deployToken);

      await expect(connect(token, fromAccount).assignPurposes(purposeAccount.address, [PURPOSE_1]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Function 'restrictionIncrease()' V1", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      const balanceOfRestrictedBefore: bigint = 0n;
      const increasingAmount = 100;
      const expectedNewRestrictedBalance = balanceOfRestrictedBefore + BigInt(increasingAmount);

      await expect(connect(token, blocklister).restrictionIncrease(fromAccount.address, OBSOLETE_ID, increasingAmount))
        .to.emit(token, "RestrictionChanged")
        .withArgs(
          fromAccount.address,
          OBSOLETE_ADDRESS,
          ANY_ID,
          expectedNewRestrictedBalance, // newBalanceSpecific
          balanceOfRestrictedBefore, // oldBalanceSpecific
          expectedNewRestrictedBalance, // newBalanceTotal
          balanceOfRestrictedBefore // oldBalanceTotal
        );

      const balanceOfRestrictedAfterV1 = await token.balanceOfRestricted(fromAccount.address, PURPOSE_ZERO);
      expect(balanceOfRestrictedAfterV1).to.eq(expectedNewRestrictedBalance);

      await checkRestrictedBalancesV2(token, {
        id: ANY_ID,
        expectedRestrictedBalanceSpecific: expectedNewRestrictedBalance,
        expectedRestrictedBalanceTotal: expectedNewRestrictedBalance,
        toAddress: OBSOLETE_ADDRESS
      });
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, fromAccount).restrictionIncrease(fromAccount.address, OBSOLETE_ID, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided id is not the obsolete purpose", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).restrictionIncrease(fromAccount.address, PURPOSE_1, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
    });
  });

  describe("Function 'restrictionDecrease()' V1", async () => {
    it("Executes as expected and emits correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, blocklister).restrictionIncrease(fromAccount.address, OBSOLETE_ID, 100));

      const balanceOfRestrictedBefore = 100n;
      const decreasingAmount = 50;
      const expectedNewRestrictedBalance = balanceOfRestrictedBefore - BigInt(decreasingAmount);

      await expect(connect(token, blocklister).restrictionDecrease(fromAccount.address, OBSOLETE_ID, decreasingAmount))
        .to.emit(token, "RestrictionChanged")
        .withArgs(
          fromAccount.address,
          OBSOLETE_ADDRESS,
          ANY_ID,
          expectedNewRestrictedBalance, // newBalanceSpecific
          balanceOfRestrictedBefore, // oldBalanceSpecific
          expectedNewRestrictedBalance, // newBalanceTotal
          balanceOfRestrictedBefore // oldBalanceTotal
        );

      const balanceOfRestrictedAfterV1 = await token.balanceOfRestricted(fromAccount.address, PURPOSE_ZERO);
      expect(balanceOfRestrictedAfterV1).to.eq(expectedNewRestrictedBalance);

      await checkRestrictedBalancesV2(token, {
        id: ANY_ID,
        expectedRestrictedBalanceSpecific: expectedNewRestrictedBalance,
        expectedRestrictedBalanceTotal: expectedNewRestrictedBalance,
        toAddress: OBSOLETE_ADDRESS
      });
    });

    it("Is reverted if the caller is not the blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, fromAccount).restrictionDecrease(fromAccount.address, OBSOLETE_ID, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided id is not obsolete purpose", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await expect(connect(token, blocklister).restrictionDecrease(fromAccount.address, PURPOSE_1, 100))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
    });
  });

  describe("Function 'restrictionIncrease()' V2", async () => {
    async function checkRestrictionIncreaseV2(token: Contract, props: {
      id: string;
      oldRestrictedBalanceSpecific?: bigint;
      oldRestrictedBalanceTotal?: bigint;
    }): Promise<{ newRestrictedBalanceSpecific: bigint; newRestrictedBalanceTotal: bigint }> {
      const id = props.id;
      const oldRestrictedBalanceSpecific: bigint = props.oldRestrictedBalanceSpecific ?? 0n;
      const oldRestrictedBalanceTotal: bigint = props.oldRestrictedBalanceTotal ?? 0n;
      const increasingAmount = 100;
      const newRestrictedBalanceSpecific = oldRestrictedBalanceSpecific + BigInt(increasingAmount);
      const newRestrictedBalanceTotal = oldRestrictedBalanceTotal + BigInt(increasingAmount);

      await expect(
        token[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, increasingAmount, id)
      ).to.emit(
        token,
        "RestrictionChanged"
      ).withArgs(
        fromAccount.address,
        toAccount.address,
        id,
        newRestrictedBalanceSpecific,
        oldRestrictedBalanceSpecific,
        newRestrictedBalanceTotal,
        oldRestrictedBalanceTotal
      );

      await checkRestrictedBalancesV2(token, {
        id,
        expectedRestrictedBalanceSpecific: newRestrictedBalanceSpecific,
        expectedRestrictedBalanceTotal: newRestrictedBalanceTotal
      });

      return {
        newRestrictedBalanceSpecific,
        newRestrictedBalanceTotal
      };
    }

    describe("Executes as expected and emits the correct event if", async () => {
      it("It is called for a specific ID twice", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        const result = await checkRestrictionIncreaseV2(tokenUnderBlocklister, { id: ID1 });
        await checkRestrictionIncreaseV2(tokenUnderBlocklister, {
          id: ID1,
          oldRestrictedBalanceSpecific: result.newRestrictedBalanceSpecific,
          oldRestrictedBalanceTotal: result.newRestrictedBalanceTotal
        });
      });

      it("It is called for the universal ID twice", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        const result = await checkRestrictionIncreaseV2(tokenUnderBlocklister, { id: ANY_ID });
        await checkRestrictionIncreaseV2(tokenUnderBlocklister, {
          id: ANY_ID,
          oldRestrictedBalanceSpecific: result.newRestrictedBalanceSpecific,
          oldRestrictedBalanceTotal: result.newRestrictedBalanceTotal
        });
      });

      it("It is called for a specific ID, then for the universal ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        const result = await checkRestrictionIncreaseV2(tokenUnderBlocklister, { id: ID1 });
        await checkRestrictionIncreaseV2(tokenUnderBlocklister, {
          id: ANY_ID,
          oldRestrictedBalanceSpecific: 0n,
          oldRestrictedBalanceTotal: result.newRestrictedBalanceTotal
        });
      });

      it("It is called for the universal ID, then for a specific ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        const result = await checkRestrictionIncreaseV2(tokenUnderBlocklister, { id: ANY_ID });
        await checkRestrictionIncreaseV2(tokenUnderBlocklister, {
          id: ID1,
          oldRestrictedBalanceSpecific: 0n,
          oldRestrictedBalanceTotal: result.newRestrictedBalanceTotal
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The caller is not the blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(
          connect(token, fromAccount)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
      });

      it("The 'from' address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);

        await expect(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](ADDRESS_ZERO, toAccount.address, 100, ID1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
      });

      it("The 'to' address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);

        await expect(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, ADDRESS_ZERO, 100, ID1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
      });

      it("The 'id' parameter is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);

        await expect(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID_ZERO)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ID);
      });

      it("The 'amount' parameter is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);

        await expect(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 0, ID1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
      });
    });
  });

  describe("Function 'restrictionDecrease()' V2", async () => {
    async function checkRestrictionDecreaseV2(token: Contract, props: {
      id: string;
      oldRestrictedBalanceSpecific: bigint;
      oldRestrictedBalanceTotal: bigint;
    }): Promise<{ newRestrictedBalanceSpecific: bigint; newRestrictedBalanceTotal: bigint }> {
      const id = props.id;
      const oldRestrictedBalanceSpecific: bigint = props.oldRestrictedBalanceSpecific;
      const oldRestrictedBalanceTotal: bigint = props.oldRestrictedBalanceTotal;
      const decreasingAmount = 50;
      const newRestrictedBalanceSpecific = oldRestrictedBalanceSpecific - BigInt(decreasingAmount);
      const newRestrictedBalanceTotal = oldRestrictedBalanceTotal - BigInt(decreasingAmount);

      await expect(
        token[FUNC_RESTRICTION_DECREASE_V2](fromAccount.address, toAccount.address, decreasingAmount, id)
      ).to.emit(
        token,
        "RestrictionChanged"
      ).withArgs(
        fromAccount.address,
        toAccount.address,
        id,
        newRestrictedBalanceSpecific,
        oldRestrictedBalanceSpecific,
        newRestrictedBalanceTotal,
        oldRestrictedBalanceTotal
      );

      await checkRestrictedBalancesV2(token, {
        id,
        expectedRestrictedBalanceSpecific: newRestrictedBalanceSpecific,
        expectedRestrictedBalanceTotal: newRestrictedBalanceTotal
      });

      return {
        newRestrictedBalanceSpecific,
        newRestrictedBalanceTotal
      };
    }

    describe("Executes as expected and emits the correct event if", async () => {
      it("It is called for a specific ID once", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        await proveTx(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        );
        await proveTx(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 200, ANY_ID)
        );
        await checkRestrictionDecreaseV2(tokenUnderBlocklister, {
          id: ID1,
          oldRestrictedBalanceSpecific: 100n,
          oldRestrictedBalanceTotal: 300n
        });
      });

      it("It is called for a universal ID once", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tokenUnderBlocklister = connect(token, blocklister);
        await proveTx(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        );
        await proveTx(
          tokenUnderBlocklister[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 200, ANY_ID)
        );
        await checkRestrictionDecreaseV2(tokenUnderBlocklister, {
          id: ANY_ID,
          oldRestrictedBalanceSpecific: 200n,
          oldRestrictedBalanceTotal: 300n
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(
          connect(token, fromAccount)[FUNC_RESTRICTION_DECREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
      });

      it("There is not enough restricted balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(
          connect(token, blocklister)[FUNC_RESTRICTION_DECREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        ).to.be.revertedWithPanic(0x11);
      });
    });
  });

  describe("Function 'migrateBalance()'", async () => {
    it("Executes as expected if the 'to' address is obsolete", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mockRestrictedPurposeBalances(fromAccount.address, OBSOLETE_ID, 100));

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(fromAccount.address, OBSOLETE_ADDRESS));

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, OBSOLETE_ADDRESS, ANY_ID)).to.eq(100);
    });

    it("Executes as expected if the 'to' address is not obsolete", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mockRestrictedPurposeBalances(fromAccount.address, OBSOLETE_ID, 100));

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(fromAccount.address, toAccount.address));

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(100);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
    });

    it("Executes as expected if the obsolete amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);

      await proveTx(token.migrateBalance(fromAccount.address, OBSOLETE_ADDRESS));

      expect(await token.balanceOfRestricted(fromAccount.address, OBSOLETE_ID)).to.eq(0);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, OBSOLETE_ADDRESS, ANY_ID)).to.eq(0);
    });
  });

  describe("Function 'transferWithId()'", async () => {
    describe("Executes as expected and emits correct events if", async () => {
      it("There is only restricted balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 100));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        );

        const tx = await connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 100, ID1);
        await expect(tx).to.emit(token, "RestrictionChanged")
          .withArgs(
            fromAccount,
            toAccount,
            ID1,
            0, // newRestrictedBalanceToID
            100, // oldRestrictedBalanceToId
            0, // newRestrictedBalanceTotal
            100 // oldRestrictedBalanceTotal
          );

        await expect(tx).to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-100, 100]
        );

        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
      });

      it("There is restricted and free balances", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 200));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ID1)
        );

        const tx = await connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 100, ID1);

        await expect(tx).to.emit(token, "RestrictionChanged")
          .withArgs(
            fromAccount,
            toAccount,
            ID1,
            0, // newRestrictedBalanceToID
            100, // oldRestrictedBalanceToId
            0, // newRestrictedBalanceTotal
            100 // oldRestrictedBalanceTotal
          );

        await expect(tx).to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-100, 100]
        );

        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
      });

      it("The restriction is partially covered by a specific ID and ANY_ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 150));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ANY_ID)
        );

        const tx = await connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 80, ID1);

        await expect(tx).to.emit(token, "RestrictionChanged")
          .withArgs(
            fromAccount,
            toAccount,
            ID1,
            0, // newRestrictedBalanceToID
            50, // oldRestrictedBalanceToId
            70, // newRestrictedBalanceTotal
            150 // oldRestrictedBalanceTotal
          ).and.to.emit(token, "RestrictionChanged") // ANY_ID restricted amount changed event
          .withArgs(
            fromAccount,
            toAccount,
            ANY_ID,
            70, // newRestrictedBalanceToID
            100, // oldRestrictedBalanceToId
            70, // newRestrictedBalanceTotal
            150 // oldRestrictedBalanceTotal
          );

        await expect(tx).to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-80, 80]
        );

        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(70);
        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID1)).to.eq(0);
      });

      it("The restriction is fully covered by a specific ID and ANY_ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 200));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ANY_ID)
        );

        const tx = await connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 200, ID1);

        await expect(tx).to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-200, 200]
        );

        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID1)).to.eq(0);
      });

      it("The account have more than one restriction by ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 200));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID2)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ANY_ID)
        );

        const tx = await connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 150, ID1);

        await expect(tx).to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-150, 150]
        );

        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID1)).to.eq(0);
        expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID2)).to.eq(50);
      });
    });

    describe("Is reverted if", async () => {
      it("The total restriction amount consists of different restriction ids", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(fromAccount.address, 200));
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID2)
        );
        await proveTx(
          connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 100, ANY_ID)
        );

        await expect(connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 200, ID1))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
      });

      it("The caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(token.transferWithId(fromAccount.address, toAccount.address, 100, ANY_ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
      });

      it("The 'from' address or the 'to' address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(connect(token, blocklister).transferWithId(ADDRESS_ZERO, toAccount.address, 100, ANY_ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);

        await expect(connect(token, blocklister).transferWithId(fromAccount.address, ADDRESS_ZERO, 100, ANY_ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
      });

      it("The 'id' parameter is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 100, ID_ZERO))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ID);
      });

      it("The 'id' parameter is ANY_ID", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);

        await expect(connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 100, ANY_ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INVALID_ID);
      });
    });
  });

  describe("Restricted scenarios", async () => {
    it("Allows default transfer if the amount does not affect restricted balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(fromAccount.address, 100));
      await proveTx(
        connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
      );
      await expect(connect(token, fromAccount).transfer(toAccount.address, 50))
        .to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-50, 50]
        );

      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID1)).to.eq(50);
    });

    it("Allows only 'transferWithId' if the amount uses the restricted balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mint(fromAccount.address, 100));
      await proveTx(
        connect(token, blocklister)[FUNC_RESTRICTION_INCREASE_V2](fromAccount.address, toAccount.address, 50, ID1)
      );

      await expect(connect(token, fromAccount).transfer(toAccount.address, 80))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ID1)).to.eq(50);

      await expect(connect(token, blocklister).transferWithId(fromAccount.address, toAccount.address, 80, ID1))
        .to.changeTokenBalances(
          token,
          [fromAccount, toAccount],
          [-80, 80]
        );

      expect(await token[FUNC_BALANCE_OF_RESTRICTED_V2](fromAccount.address, toAccount.address, ANY_ID)).to.eq(0);
    });
  });
});
