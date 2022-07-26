import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";
import { countNumberArrayTotal } from "../../test-utils/misc";

interface TestTokenRelocation {
  chainId: number;
  token: Contract;
  account: SignerWithAddress;
  amount: number;
  nonce: number;
  registered?: boolean;
  processed?: boolean;
  canceled?: boolean;
}

interface BridgeStateForChainId {
  registeredRelocationCount: number;
  processedRelocationCount: number;
  pendingRelocationCount: number;
  firstNonce: number;
  nonceCount: number;
  tokens: string[];
  accounts: string[];
  amounts: BigNumber[];
  cancellationFlags: boolean[];
}

function checkEquality(
  actualOnChainRelocation: any,
  expectedRelocation: TestTokenRelocation,
  relocationIndex: number
) {
  expect(actualOnChainRelocation.token).to.equal(
    expectedRelocation.token.address,
    `relocation[${relocationIndex}].token is incorrect, chainId=${expectedRelocation.chainId}`
  );
  expect(actualOnChainRelocation.account).to.equal(
    expectedRelocation.account.address,
    `relocation[${relocationIndex}].account is incorrect, chainId=${expectedRelocation.chainId}`
  );
  expect(actualOnChainRelocation.amount).to.equal(
    expectedRelocation.amount,
    `relocation[${relocationIndex}].amount is incorrect, chainId=${expectedRelocation.chainId}`
  );
  expect(actualOnChainRelocation.canceled).to.equal(
    !!expectedRelocation.canceled,
    `relocation[${relocationIndex}].canceled is incorrect, chainId=${expectedRelocation.chainId}`
  );
}

function countRelocationsForChainId(relocations: TestTokenRelocation[], targetChainId: number) {
  return countNumberArrayTotal(
    relocations.map(
      function (relocation: TestTokenRelocation): number {
        return (relocation.chainId == targetChainId) ? 1 : 0;
      }
    )
  );
}

function markRelocationsAsProcessed(relocations: TestTokenRelocation[]) {
  relocations.forEach((relocation: TestTokenRelocation) => relocation.processed = true);
}

function getAmountsByToken(relocations: TestTokenRelocation[], targetToken: Contract): number[] {
  return relocations.map((relocation: TestTokenRelocation) =>
    relocation.token == targetToken && !relocation.canceled ? relocation.amount : 0
  );
}

describe("Contract 'MultiTokenBridgeUpgradeable'", async () => {
  // Revert messages
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED =
    "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER =
    "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_TOKEN_DOES_NOT_SUPPORT_BRIDGE_OPERATIONS =
    "MultiTokenBridge: token contract does not support bridge operations";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED =
    "Pausable: paused";
  const REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_RELOCATION =
    "MultiTokenBridge: chain or token is not supported for relocation";
  const REVERT_MESSAGE_IF_RELOCATION_ADDRESS_IS_ZERO =
    "MultiTokenBridge: token is the zero address";
  const REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO =
    "MultiTokenBridge: relocation amount must be greater than 0";
  const REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED =
    "MultiTokenBridge: bridge is not supported by the token contract";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED =
    "Whitelistable: account is not whitelisted";
  const REVERT_MESSAGE_IF_RELOCATION_COUNT_IS_ZERO =
    "MultiTokenBridge: count should be greater than zero";
  const REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS =
    "MultiTokenBridge: count exceeds the number of pending relocations";
  const REVERT_MESSAGE_IF_BURNING_OF_TOKENS_FAILED =
    "MultiTokenBridge: burning of tokens failed";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE =
    "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED =
    "MultiTokenBridge: transaction sender is not authorized";
  const REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY =
    "MultiTokenBridge: relocation nonces array is empty";
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED =
    "MultiTokenBridge: relocation with the nonce already processed";
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST =
    "MultiTokenBridge: relocation with the nonce does not exist";
  const REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED =
    "MultiTokenBridge: relocation was already canceled";
  const REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_ARRIVAL =
    "MultiTokenBridge: chain or token is not supported for arrival";
  const REVERT_MESSAGE_IF_ARRIVAL_FIRST_NONCE_IS_ZERO =
    "MultiTokenBridge: must be greater than 0";
  const REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR =
    "MultiTokenBridge: input arrays have different length";
  const REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH =
    "MultiTokenBridge: relocation nonce mismatch";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS =
    "MultiTokenBridge: account is the zero address";
  const REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO =
    "MultiTokenBridge: amount must be greater than 0";
  const REVERT_MESSAGE_IF_MINTING_OF_TOKENS_FAILED =
    "MultiTokenBridge: minting of tokens failed";

  let multiTokenBridge: Contract;
  let tokenMock1: Contract;
  let tokenMock2: Contract;
  let fakeTokenAddress: string;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  async function deployTokenMock(serialNumber: number): Promise<Contract> {
    const name = "BRL Coin " + serialNumber;
    const symbol = "BRLC" + serialNumber;
    const TokenMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    const tokenMock: Contract = await upgrades.deployProxy(TokenMock, [name, symbol, 6]);
    await tokenMock.deployed();

    // Set the bridge in the token
    await proveTx(tokenMock.setBridge(multiTokenBridge.address));
    return tokenMock;
  }

  async function setUpContractsForRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(multiTokenBridge.setSupportedRelocation(
        relocation.chainId,
        relocation.token.address,
        true
      ));
      await proveTx(relocation.token.mint(relocation.account.address, relocation.amount));
      const allowance: BigNumber =
        await relocation.token.allowance(relocation.account.address, multiTokenBridge.address);
      if (allowance.lt(BigNumber.from(ethers.constants.MaxUint256))) {
        await proveTx(relocation.token.connect(relocation.account).approve(
          multiTokenBridge.address,
          ethers.constants.MaxUint256
        ));
      }
    }
  }

  async function registerRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(
        multiTokenBridge.connect(relocation.account).registerRelocation(
          relocation.chainId,
          relocation.token.address,
          relocation.amount)
      );
      relocation.registered = true;
    }
  }

  async function pauseMultiTokenBridge() {
    await proveTx(multiTokenBridge.setPauser(deployer.address));
    await proveTx(multiTokenBridge.pause());
  }

  async function addAccountToBridgeWhitelist(account: SignerWithAddress) {
    await proveTx(multiTokenBridge.setWhitelistEnabled(true));
    await proveTx(multiTokenBridge.setWhitelistAdmin(deployer.address));
    await proveTx(multiTokenBridge.updateWhitelister(deployer.address, true));
    await proveTx(multiTokenBridge.whitelist(account.address));
  }

  async function cancelRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(
        multiTokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
      );
      relocation.canceled = true;
    }
  }

  function defineExpectedChainIds(relocations: TestTokenRelocation[]): Set<number> {
    const expectedChainIds: Set<number> = new Set<number>();

    relocations.forEach((relocation: TestTokenRelocation) => {
      expectedChainIds.add(relocation.chainId);
    });

    return expectedChainIds;
  }

  function defineExpectedTokens(relocations: TestTokenRelocation[]): Set<Contract> {
    const expectedTokens: Set<Contract> = new Set<Contract>();

    relocations.forEach((relocation: TestTokenRelocation) => {
      expectedTokens.add(relocation.token);
    });

    return expectedTokens;
  }

  function defineExpectedBridgeStateForSingleChainId(
    chainId: number,
    relocations: TestTokenRelocation[]
  ): BridgeStateForChainId {
    const expectedBridgeState: BridgeStateForChainId = {
      registeredRelocationCount: 0,
      processedRelocationCount: 0,
      pendingRelocationCount: 0,
      firstNonce: 0,
      nonceCount: 1,
      tokens: [ethers.constants.AddressZero],
      accounts: [ethers.constants.AddressZero],
      amounts: [BigNumber.from(0)],
      cancellationFlags: [false],
    };
    expectedBridgeState.registeredRelocationCount = countNumberArrayTotal(
      relocations.map(
        function (relocation: TestTokenRelocation): number {
          return !!relocation.registered && relocation.chainId == chainId ? 1 : 0;
        }
      )
    );

    expectedBridgeState.processedRelocationCount = countNumberArrayTotal(
      relocations.map(
        function (relocation: TestTokenRelocation): number {
          return !!relocation.processed && relocation.chainId == chainId ? 1 : 0;
        }
      )
    );

    relocations.forEach((relocation: TestTokenRelocation) => {
      if (!!relocation.registered && relocation.chainId == chainId) {
        expectedBridgeState.tokens[relocation.nonce] = relocation.token.address;
        expectedBridgeState.accounts[relocation.nonce] = relocation.account.address;
        expectedBridgeState.amounts[relocation.nonce] = BigNumber.from(relocation.amount);
        expectedBridgeState.cancellationFlags[relocation.nonce] = !!relocation.canceled;
      }
    });
    expectedBridgeState.tokens[expectedBridgeState.tokens.length] = ethers.constants.AddressZero;
    expectedBridgeState.accounts[expectedBridgeState.accounts.length] = ethers.constants.AddressZero;
    expectedBridgeState.amounts[expectedBridgeState.amounts.length] = BigNumber.from(0);
    expectedBridgeState.cancellationFlags[expectedBridgeState.cancellationFlags.length] = false;
    expectedBridgeState.nonceCount = expectedBridgeState.accounts.length;

    expectedBridgeState.pendingRelocationCount =
      expectedBridgeState.registeredRelocationCount - expectedBridgeState.processedRelocationCount;

    return expectedBridgeState;
  }

  function defineExpectedBridgeStatesPerChainId(
    relocations: TestTokenRelocation[]
  ): Map<number, BridgeStateForChainId> {
    const expectedChainIds: Set<number> = defineExpectedChainIds(relocations);
    const expectedStatesByChainId: Map<number, BridgeStateForChainId> = new Map<number, BridgeStateForChainId>();

    expectedChainIds.forEach((chainId: number) => {
      const expectedBridgeState: BridgeStateForChainId =
        defineExpectedBridgeStateForSingleChainId(chainId, relocations);
      expectedStatesByChainId.set(chainId, expectedBridgeState);
    });

    return expectedStatesByChainId;
  }

  function defineExpectedBridgeBalancesPerTokens(relocations: TestTokenRelocation[]): Map<Contract, number> {
    const expectedTokens: Set<Contract> = defineExpectedTokens(relocations);
    const expectedBridgeBalancesPerToken: Map<Contract, number> = new Map<Contract, number>();

    expectedTokens.forEach((token: Contract) => {
      const expectedBalance: number = countNumberArrayTotal(
        relocations.map(
          function (relocation: TestTokenRelocation): number {
            if (relocation.token == token
              && !!relocation.registered
              && !relocation.processed
              && !relocation.canceled
            ) {
              return relocation.amount;
            } else {
              return 0;
            }
          }
        )
      );
      expectedBridgeBalancesPerToken.set(token, expectedBalance);
    });
    return expectedBridgeBalancesPerToken;
  }

  async function checkBridgeStatesPerChainId(expectedBridgeStatesByChainId: Map<number, BridgeStateForChainId>) {
    for (const expectedChainId of expectedBridgeStatesByChainId.keys()) {
      const expectedBridgeState: BridgeStateForChainId | undefined = expectedBridgeStatesByChainId.get(expectedChainId);
      if (!expectedBridgeState) {
        continue;
      }
      expect(await multiTokenBridge.pendingRelocationCounters(expectedChainId)).to.equal(
        expectedBridgeState.pendingRelocationCount,
        `Wrong pending relocation count, chainId=${expectedChainId}`
      );
      expect(await multiTokenBridge.lastConfirmedRelocationNonces(expectedChainId)).to.equal(
        expectedBridgeState.processedRelocationCount,
        `Wrong registered relocation count, chainId=${expectedChainId}`
      );
      const actualRelocationData = await multiTokenBridge.getRelocationsData(
        expectedChainId,
        expectedBridgeState.firstNonce,
        expectedBridgeState.nonceCount
      );
      expect(actualRelocationData.accounts).to.deep.equal(
        expectedBridgeState.accounts,
        `Wrong the accounts array returned by the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
      expect(actualRelocationData.amounts).to.deep.equal(
        expectedBridgeState.amounts,
        `Wrong the amounts array returned by the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
      expect(actualRelocationData.cancellationFlags).to.deep.equal(
        expectedBridgeState.cancellationFlags,
        `Wrong the cancellationFlags array returned by `
        + `the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
    }
  }

  async function checkRelocationStructures(relocations: TestTokenRelocation[]) {
    for (let i = 0; i < relocations.length; ++i) {
      const relocation = relocations[i];
      if (relocation.registered) {
        const actualRelocation = await multiTokenBridge.relocations(relocation.chainId, relocation.nonce);
        checkEquality(actualRelocation, relocation, i);
      }
    }
  }

  async function checkBridgeBalancesPerToken(expectedBalancesPerToken: Map<Contract, number>) {
    for (const expectedToken of expectedBalancesPerToken.keys()) {
      const expectedBalance: number | undefined = expectedBalancesPerToken.get(expectedToken);
      if (!expectedBalance) {
        continue;
      }
      const tokenSymbol = await expectedToken.symbol();
      expect(await expectedToken.balanceOf(multiTokenBridge.address))
        .to.equal(
        expectedBalance,
        `Balance is wrong for token with symbol ${tokenSymbol}`
      );
    }
  }

  async function checkBridgeState(relocations: TestTokenRelocation[]): Promise<void> {
    const expectedBridgeStatesByChainId: Map<number, BridgeStateForChainId> =
      defineExpectedBridgeStatesPerChainId(relocations);
    const expectedBridgeBalancesPerToken: Map<Contract, number> = defineExpectedBridgeBalancesPerTokens(relocations);

    await checkBridgeStatesPerChainId(expectedBridgeStatesByChainId);
    await checkRelocationStructures(relocations);
    await checkBridgeBalancesPerToken(expectedBridgeBalancesPerToken);
  }

  beforeEach(async () => {
    // Deploy TokenBridge
    const MultiTokenBridge: ContractFactory = await ethers.getContractFactory("MultiTokenBridgeUpgradeable");
    multiTokenBridge = await upgrades.deployProxy(MultiTokenBridge);
    await multiTokenBridge.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();

    fakeTokenAddress = user1.address;

    tokenMock1 = await deployTokenMock(1);
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      multiTokenBridge.initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Configuration", async () => {

    describe("Function 'setSupportedRelocation()'", async () => {
      const chainId = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          multiTokenBridge.connect(user1).setSupportedRelocation(
            chainId,
            tokenMock1.address,
            true
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Is reverted if token does not support bridge operations", async () => {
        await expect(
          multiTokenBridge.setSupportedRelocation(
            chainId,
            fakeTokenAddress,
            true
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_DOES_NOT_SUPPORT_BRIDGE_OPERATIONS);
      });

      it("Emits the correct events and updates the configuration correctly", async () => {
        tokenMock1 = await deployTokenMock(1);
        const relocationSupportingFlagOld =
          await multiTokenBridge.relocationSupportingFlags(chainId, tokenMock1.address);
        expect(relocationSupportingFlagOld).to.equal(false);
        await expect(
          multiTokenBridge.setSupportedRelocation(
            chainId,
            tokenMock1.address,
            true
          )
        ).to.emit(
          multiTokenBridge,
          "SetSupportedRelocation"
        ).withArgs(
          chainId,
          tokenMock1.address,
          true
        );
        const relocationSupportingFlagNew =
          await multiTokenBridge.relocationSupportingFlags(chainId, tokenMock1.address);
        expect(relocationSupportingFlagNew).to.equal(true);

        await expect(
          multiTokenBridge.setSupportedRelocation(
            chainId,
            tokenMock1.address,
            false
          )
        ).to.emit(
          multiTokenBridge,
          "SetSupportedRelocation"
        ).withArgs(
          chainId,
          tokenMock1.address,
          false
        );
        const relocationSupportingFlagNew2 =
          await multiTokenBridge.relocationSupportingFlags(chainId, tokenMock1.address);
        expect(relocationSupportingFlagNew2).to.equal(false);
      });
    });

    describe("Function 'setSupportedArrival()'", async () => {
      const chainId = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          multiTokenBridge.connect(user1).setSupportedArrival(
            chainId,
            tokenMock1.address,
            true
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Is reverted if token does not support bridge operations", async () => {
        await expect(
          multiTokenBridge.setSupportedArrival(
            chainId,
            fakeTokenAddress,
            true
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_DOES_NOT_SUPPORT_BRIDGE_OPERATIONS);
      });

      it("Emits the correct events and updates the configuration correctly", async () => {
        tokenMock1 = await deployTokenMock(1);
        const arrivalSupportingFlagOld =
          await multiTokenBridge.arrivalSupportingFlags(chainId, tokenMock1.address);
        expect(arrivalSupportingFlagOld).to.equal(false);
        await expect(
          multiTokenBridge.setSupportedArrival(
            chainId,
            tokenMock1.address,
            true
          )
        ).to.emit(
          multiTokenBridge,
          "SetSupportedArrival"
        ).withArgs(
          chainId,
          tokenMock1.address,
          true
        );
        const arrivalSupportingFlagNew =
          await multiTokenBridge.arrivalSupportingFlags(chainId, tokenMock1.address);
        expect(arrivalSupportingFlagNew).to.equal(true);

        await expect(
          multiTokenBridge.setSupportedArrival(
            chainId,
            tokenMock1.address,
            false
          )
        ).to.emit(
          multiTokenBridge,
          "SetSupportedArrival"
        ).withArgs(
          chainId,
          tokenMock1.address,
          false
        );
        const arrivalSupportingFlagNew2 =
          await multiTokenBridge.arrivalSupportingFlags(chainId, tokenMock1.address);
        expect(arrivalSupportingFlagNew2).to.equal(false);
      });
    });
  });

  describe("Interactions related to relocations", async () => {

    describe("Function 'registerRelocation()'", async () => {
      let relocation: TestTokenRelocation;

      beforeEach(async () => {
        relocation = {
          chainId: 123,
          token: tokenMock1,
          account: user1,
          amount: 456,
          nonce: 1,
        };
        await setUpContractsForRelocations([relocation]);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseMultiTokenBridge();
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            fakeTokenAddress,
            relocation.amount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the token address is zero", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            ethers.constants.AddressZero,
            relocation.amount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_ADDRESS_IS_ZERO);
      });

      it("Is reverted if the token amount of the relocation is zero", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            relocation.token.address,
            0
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO);
      });

      it("Is reverted if the target chain is unsupported for relocations", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId + 1,
            relocation.token.address,
            relocation.amount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_RELOCATION);
      });

      it("Is reverted if the token is unsupported for relocations", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            fakeTokenAddress,
            relocation.amount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_RELOCATION);
      });

      it("Is reverted if the token does not support the bridge", async () => {
        await proveTx(tokenMock1.setBridge(deployer.address));
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            relocation.token.address,
            relocation.amount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if the user has not enough token balance", async () => {
        const excessTokenAmount: number = relocation.amount + 1;
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            relocation.token.address,
            excessTokenAmount
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });

      it("Transfers tokens as expected, emits the correct event, changes the state properly", async () => {
        await checkBridgeState([relocation]);
        await expect(
          multiTokenBridge.connect(relocation.account).registerRelocation(
            relocation.chainId,
            relocation.token.address,
            relocation.amount
          )
        ).to.changeTokenBalances(
          relocation.token,
          [multiTokenBridge, relocation.amount],
          [+relocation.amount, -relocation.amount,]
        ).and.to.emit(
          multiTokenBridge,
          "RegisterRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.token.address,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
        );
        relocation.registered = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Function 'cancelRelocation()'", async () => {
      let relocation: TestTokenRelocation;

      beforeEach(async () => {
        relocation = {
          chainId: 234,
          token: tokenMock1,
          account: user1,
          amount: 567,
          nonce: 1,
        };
        await setUpContractsForRelocations([relocation]);
        await registerRelocations([relocation]);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseMultiTokenBridge();
        await expect(
          multiTokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller did not request the relocation", async () => {
        await expect(
          multiTokenBridge.connect(user2).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce has already processed", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce - 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce does not exists", async () => {
        await expect(
          multiTokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Transfers the tokens as expected, emits the correct event, changes the state properly", async () => {
        await checkBridgeState([relocation]);
        await expect(
          multiTokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.changeTokenBalances(
          tokenMock1,
          [multiTokenBridge, relocation.account],
          [-relocation.amount, +relocation.amount]
        ).and.to.emit(
          multiTokenBridge,
          "CancelRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.token.address,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
        );
        relocation.canceled = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Function 'cancelRelocations()'", async () => {
      const chainId = 12;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;
      let relocationNonces: number[];

      beforeEach(async () => {
        tokenMock2 = await deployTokenMock(2);

        relocations = [
          {
            chainId: chainId,
            token: tokenMock1,
            account: user1,
            amount: 34,
            nonce: 1,
          },
          {
            chainId: chainId,
            token: tokenMock2,
            account: user2,
            amount: 56,
            nonce: 2,
          },
        ];
        relocationNonces = relocations.map((relocation: TestTokenRelocation) => relocation.nonce);
        relocator = user2;
        await setUpContractsForRelocations(relocations);
        await registerRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseMultiTokenBridge();
        await expect(
          multiTokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          multiTokenBridge.connect(deployer).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the input array of nonces is empty", async () => {
        await expect(
          multiTokenBridge.connect(relocator).cancelRelocations(chainId, [])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY);
      });

      it("Is reverted if some input nonce is less than the lowest nonce of pending relocations", async () => {
        await expect(multiTokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [
            Math.min(...relocationNonces),
            Math.min(...relocationNonces) - 1,
          ]
        )).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);
      });

      it("Is reverted if some input nonce is greater than the highest nonce of pending relocations", async () => {
        await expect(multiTokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [
            Math.max(...relocationNonces),
            Math.max(...relocationNonces) + 1
          ]
        )).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);
      });

      it("Is reverted if a relocation with some nonce was already canceled", async () => {
        await cancelRelocations([relocations[1]]);
        await expect(
          multiTokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await checkBridgeState(relocations);
        const relocationAccounts: SignerWithAddress[] =
          relocations.map((relocation: TestTokenRelocation) => relocation.account);
        const expectedAccountBalanceChangesForTokenMock1: number[] = getAmountsByToken(relocations, tokenMock1);
        const expectedAccountBalanceChangesForTokenMock2: number[] = getAmountsByToken(relocations, tokenMock2);
        const expectedBridgeBalanceChangeForTokenMock1 =
          countNumberArrayTotal(expectedAccountBalanceChangesForTokenMock1);
        const expectedBridgeBalanceChangeForTokenMock2 =
          countNumberArrayTotal(expectedAccountBalanceChangesForTokenMock2);

        await expect(multiTokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces))
          .to.changeTokenBalances(
            tokenMock1,
            [multiTokenBridge, ...relocationAccounts],
            [-expectedBridgeBalanceChangeForTokenMock1, ...expectedAccountBalanceChangesForTokenMock1]
          ).and.to.changeTokenBalances(
            tokenMock2,
            [multiTokenBridge, ...relocationAccounts],
            [-expectedBridgeBalanceChangeForTokenMock2, ...expectedAccountBalanceChangesForTokenMock2]
          ).and.to.emit(
            multiTokenBridge,
            "CancelRelocation"
          ).withArgs(
            chainId,
            relocations[0].token.address,
            relocations[0].account.address,
            relocations[0].amount,
            relocations[0].nonce
          ).and.to.emit(
            multiTokenBridge,
            "CancelRelocation"
          ).withArgs(
            chainId,
            relocations[1].token.address,
            relocations[1].account.address,
            relocations[1].amount,
            relocations[1].nonce
          );
        relocations.forEach((relocation: TestTokenRelocation) => relocation.canceled = true);
        await checkBridgeState(relocations);
      });
    });

    describe("Function 'relocate()'", async () => {
      const relocationCount = 1;

      let relocation: TestTokenRelocation;
      let relocator: SignerWithAddress;

      beforeEach(async () => {
        relocation = {
          chainId: 345,
          token: tokenMock1,
          account: user1,
          amount: 678,
          nonce: 1,
        };
        relocator = user2;

        await setUpContractsForRelocations([relocation]);
        await registerRelocations([relocation]);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseMultiTokenBridge();
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          multiTokenBridge.connect(deployer).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the relocation count is zero", async () => {
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_COUNT_IS_ZERO);
      });

      it("Is reverted if the relocation count exceeds the number of pending relocations", async () => {
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS);
      });

      it("Is reverted if the token does not support the bridge", async () => {
        await proveTx(tokenMock1.setBridge(deployer.address));
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if burning of tokens had failed", async () => {
        await proveTx(tokenMock1.disableBurningForBridging());
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_OF_TOKENS_FAILED);
      });

      it("Burns no tokens, emits no events if the relocation was canceled", async () => {
        await cancelRelocations([relocation]);
        await checkBridgeState([relocation]);
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.changeTokenBalances(
          tokenMock1,
          [multiTokenBridge],
          [0]
        ).and.not.to.emit(
          multiTokenBridge,
          "ConfirmRelocation"
        );
        markRelocationsAsProcessed([relocation]);
        await checkBridgeState([relocation]);
      });

      it("Burns tokens as expected, emits the correct event, changes the state properly", async () => {
        await expect(
          multiTokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.changeTokenBalances(
          tokenMock1,
          [multiTokenBridge, user1, user2],
          [-relocation.amount, 0, 0]
        ).and.to.emit(
          multiTokenBridge,
          "ConfirmRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.token.address,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
        );
        markRelocationsAsProcessed([relocation]);
        await checkBridgeState([relocation]);
      });
    });

    describe("Complex scenario for a single chain with several tokens", async () => {
      const chainId = 123;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;

      beforeEach(async () => {
        tokenMock2 = await deployTokenMock(2);

        relocations = [
          {
            chainId: chainId,
            token: tokenMock1,
            account: user1,
            amount: 234,
            nonce: 1,
          },
          {
            chainId: chainId,
            token: tokenMock2,
            account: user1,
            amount: 345,
            nonce: 2,
          },
          {
            chainId: chainId,
            token: tokenMock2,
            account: user2,
            amount: 456,
            nonce: 3,
          },
          {
            chainId: chainId,
            token: tokenMock1,
            account: deployer,
            amount: 567,
            nonce: 4,
          },
        ];
        relocator = user2;
        await setUpContractsForRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Executes as expected", async () => {
        // Register first 3 relocations
        await registerRelocations([relocations[0], relocations[1], relocations[2]]);
        await checkBridgeState(relocations);

        // Process the first relocation
        await proveTx(multiTokenBridge.connect(relocator).relocate(chainId, 1));
        markRelocationsAsProcessed([relocations[0]]);
        await checkBridgeState(relocations);

        // Try to cancel already processed relocation
        await expect(
          multiTokenBridge.connect(relocations[0].account).cancelRelocation(chainId, relocations[0].nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel a relocation of another user
        await expect(
          multiTokenBridge.connect(relocations[1].account).cancelRelocation(chainId, relocations[2].nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);

        // Try to cancel several relocations including the processed one
        await expect(
          multiTokenBridge.connect(relocator).cancelRelocations(chainId, [
            relocations[2].nonce,
            relocations[1].nonce,
            relocations[0].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel several relocations including one that is out of the pending range
        await expect(
          multiTokenBridge.connect(relocator).cancelRelocations(chainId, [
            relocations[3].nonce,
            relocations[2].nonce,
            relocations[1].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);

        //Check that state of the bridge has not changed
        await checkBridgeState(relocations);

        // Register another relocation
        await registerRelocations([relocations[3]]);
        await checkBridgeState(relocations);

        // Cancel two last relocations
        await proveTx(multiTokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [relocations[3].nonce, relocations[2].nonce]
        ));
        [relocations[3], relocations[2]].forEach((relocation: TestTokenRelocation) => relocation.canceled = true);
        await checkBridgeState(relocations);

        // Process all the pending relocations
        await proveTx(multiTokenBridge.connect(relocator).relocate(chainId, 3));
        markRelocationsAsProcessed(relocations);
        await checkBridgeState(relocations);
      });
    });

    describe("Complex scenario for several chains with several tokens", async () => {
      const chainId1 = 123;
      const chainId2 = 234;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;
      let relocationCountForChain1: number;
      let relocationCountForChain2: number;

      beforeEach(async () => {
        tokenMock2 = await deployTokenMock(2);

        relocations = [
          {
            chainId: chainId1,
            token: tokenMock2,
            account: user1,
            amount: 345,
            nonce: 1,
          },
          {
            chainId: chainId1,
            token: tokenMock1,
            account: user1,
            amount: 456,
            nonce: 2,
          },
          {
            chainId: chainId2,
            token: tokenMock1,
            account: user2,
            amount: 567,
            nonce: 1,
          },
          {
            chainId: chainId2,
            token: tokenMock2,
            account: deployer,
            amount: 678,
            nonce: 2,
          },
        ];
        relocator = user2;
        relocationCountForChain1 = countRelocationsForChainId(relocations, chainId1);
        relocationCountForChain2 = countRelocationsForChainId(relocations, chainId2);
        await setUpContractsForRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Executes as expected", async () => {
        // Register all relocations
        await registerRelocations(relocations);
        await checkBridgeState(relocations);

        // Cancel some relocations
        await cancelRelocations([relocations[1], relocations[2]]);
        await checkBridgeState(relocations);

        // Process all the pending relocations in all the chains
        await proveTx(multiTokenBridge.connect(relocator).relocate(chainId1, relocationCountForChain1));
        await proveTx(multiTokenBridge.connect(relocator).relocate(chainId2, relocationCountForChain2));
        markRelocationsAsProcessed(relocations);
        await checkBridgeState(relocations);
      });
    });
  });

  describe("Interactions related to accommodations", async () => {
    describe("Function 'accommodate()'", async () => {
      const chainId = 123;
      const firstRelocationNonce = 1;

      let relocations: TestTokenRelocation[];
      let accommodator: SignerWithAddress;
      let relocationTokenAddresses: string[];
      let relocationAccountAddresses: string[];
      let relocationAmounts: number[];
      let relocationCancellationFlags: boolean[];

      beforeEach(async () => {
        tokenMock2 = await deployTokenMock(2);

        relocations = [
          {
            chainId: chainId,
            token: tokenMock1,
            account: user1,
            amount: 456,
            nonce: firstRelocationNonce,
            canceled: true,
          },
          {
            chainId: chainId,
            token: tokenMock1,
            account: user2,
            amount: 567,
            nonce: firstRelocationNonce + 1,
          },
          {
            chainId: chainId,
            token: tokenMock2,
            account: user2,
            amount: 678,
            nonce: firstRelocationNonce + 2,
          },
        ];
        accommodator = user2;
        relocationTokenAddresses = relocations.map((relocation: TestTokenRelocation) => relocation.token.address);
        relocationAccountAddresses = relocations.map((relocation: TestTokenRelocation) => relocation.account.address);
        relocationAmounts = relocations.map((relocation: TestTokenRelocation) => relocation.amount);
        relocationCancellationFlags = relocations.map((relocation: TestTokenRelocation) => !!relocation.canceled);

        await proveTx(multiTokenBridge.setSupportedArrival(chainId, tokenMock1.address, true));
        await proveTx(multiTokenBridge.setSupportedArrival(chainId, tokenMock2.address, true));
        await addAccountToBridgeWhitelist(accommodator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseMultiTokenBridge();
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          multiTokenBridge.connect(deployer).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the chain is unsupported for arrivals", async () => {
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId + 1,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_ARRIVAL);
      });

      it("Is reverted if one of the token contracts is unsupported for arrivals", async () => {
        relocationTokenAddresses[1] = deployer.address;
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CHAIN_OR_TOKEN_IS_NOT_SUPPORTED_FOR_ARRIVAL);
      });

      it("Is reverted if the first relocation nonce is zero", async () => {
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            0,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ARRIVAL_FIRST_NONCE_IS_ZERO);
      });

      it("Is reverted if the first relocation nonce does not equal the last arrival nonce +1", async () => {
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce + 1,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH);
      });

      it("Is reverted if the tokens array has a different length than other input arrays", async () => {
        relocationTokenAddresses.pop();
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the accounts array has a different length than other input arrays", async () => {
        relocationAccountAddresses.pop();
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the amounts array has a different length than other input arrays", async () => {
        relocationAmounts.pop();
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the cancellation flags array has a different length than other input arrays", async () => {
        relocationCancellationFlags.pop();
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if one of the tokens does not support the bridge", async () => {
        await proveTx(tokenMock1.setBridge(deployer.address));
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if one of the input accounts has zero address", async () => {
        relocationAccountAddresses[1] = ethers.constants.AddressZero;
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS);
      });

      it("Is reverted if one of the input amounts is zero", async () => {
        relocationAmounts[1] = 0;
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO);
      });

      it("Is reverted if minting of tokens had failed", async () => {
        await proveTx(tokenMock1.disableMintingForBridging());
        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_OF_TOKENS_FAILED);
      });

      it("Mints tokens as expected, emits the correct events, changes the state properly", async () => {
        const expectedBalanceChangesForTokenMock1: number[] = getAmountsByToken(relocations, tokenMock1);
        const expectedBalanceChangesForTokenMock2: number[] = getAmountsByToken(relocations, tokenMock2);

        await expect(
          multiTokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationTokenAddresses,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.changeTokenBalances(
          tokenMock1,
          [multiTokenBridge, ...relocationAccountAddresses],
          [0, ...expectedBalanceChangesForTokenMock1]
        ).and.to.changeTokenBalances(
          tokenMock2,
          [multiTokenBridge, ...relocationAccountAddresses],
          [0, ...expectedBalanceChangesForTokenMock2]
        ).and.to.emit(
          multiTokenBridge,
          "ConfirmArrival"
        ).withArgs(
          chainId,
          relocations[1].token.address,
          relocations[1].account.address,
          relocations[1].amount,
          relocations[1].nonce,
        ).and.to.emit(
          multiTokenBridge,
          "ConfirmArrival"
        ).withArgs(
          chainId,
          relocations[2].token.address,
          relocations[2].account.address,
          relocations[2].amount,
          relocations[2].nonce,
        );
        expect(await multiTokenBridge.arrivalNonces(chainId)).to.equal(relocations[relocations.length - 1].nonce);
      });
    });
  });
});
