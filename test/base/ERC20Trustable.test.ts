import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20Trustable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const APPROVE_AMOUNT = 123;
  const MAX_APPROVE_AMOUNT = ethers.constants.MaxUint256;

  const EVENT_NAME_TRUSTED_ACCOUNT_CONFIGURED = "TrustedAccountConfigured";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_TRUSTED_ACCOUNT_ALREADY_CONFIGURED = "TrustedAccountAlreadyConfigured";

  let tokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let trustedAccount: SignerWithAddress;

  before(async () => {
    [deployer, user, trustedAccount] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20TrustableMock");
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.deployed();
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await token.mainBlocklister()).to.equal(ethers.constants.AddressZero);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy();
      await tokenImplementation.deployed();
      await expect(tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.call_parent_initialize_unchained())
        .to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'configureTrustedAccount()'", async () => {
    it("Executes as expected and emits the event", async () => {
      const { token } = await setUpFixture(deployToken);

      expect(await token.isTrustedAccount(trustedAccount.address)).to.eq(false);

      expect(await token.configureTrustedAccount(trustedAccount.address, true))
        .to.emit(token, EVENT_NAME_TRUSTED_ACCOUNT_CONFIGURED)
        .withArgs(trustedAccount, true);
      expect(await token.isTrustedAccount(trustedAccount.address)).to.eq(true);

      expect(await token.configureTrustedAccount(trustedAccount.address, false))
        .to.emit(token, EVENT_NAME_TRUSTED_ACCOUNT_CONFIGURED)
        .withArgs(trustedAccount, false);
      expect(await token.isTrustedAccount(trustedAccount.address)).to.eq(false);
    });

    it("Is reverted if the account is already configured", async () => {
      const { token } = await setUpFixture(deployToken);

      await proveTx(token.configureTrustedAccount(trustedAccount.address, true));
      expect(token.configureTrustedAccount(trustedAccount.address, true))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_TRUSTED_ACCOUNT_ALREADY_CONFIGURED);

      await proveTx(token.configureTrustedAccount(trustedAccount.address, false));
      expect(token.configureTrustedAccount(trustedAccount.address, false))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_TRUSTED_ACCOUNT_ALREADY_CONFIGURED);
    });

    it("Is reverted if the caller is not an owner", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(token.connect(user).configureTrustedAccount(trustedAccount.address, true))
        .to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'allowance()'", async () => {
    it("Returns correct allowance if spender is marked as trusted", async () => {
      const { token } = await setUpFixture(deployToken);

      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(0);

      await proveTx(token.connect(user).approve(trustedAccount.address, APPROVE_AMOUNT));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(APPROVE_AMOUNT);

      await proveTx(token.configureTrustedAccount(trustedAccount.address, true));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(MAX_APPROVE_AMOUNT);

      await proveTx(token.connect(user).approve(trustedAccount.address, APPROVE_AMOUNT * 2));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(MAX_APPROVE_AMOUNT);

      await proveTx(token.configureTrustedAccount(trustedAccount.address, false));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(APPROVE_AMOUNT * 2);
    });
  });
});
