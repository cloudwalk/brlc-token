import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture(func: any) {
    if (network.name === "hardhat") {
        return loadFixture(func);
    } else {
        return func();
    }
}

describe("Contract 'ERC20Base'", async () => {
    const TOKEN_NAME = "BRL Coin";
    const TOKEN_SYMBOL = "BRLC";
    const TOKEN_DECIMALS = 6;

    const TOKEN_AMOUNT: number = 100;
    const TOKEN_ALLOWANCE: number = 200;

    const EVENT_NAME_APPROVAL = "Approval";
    const EVENT_NAME_TRANSFER = "Transfer";

    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
        "Initializable: contract is already initialized";
    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
    const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

    const REVERT_ERROR_BLACKLISTED_ACCOUNT = "BlacklistedAccount";

    let tokenFactory: ContractFactory;
    let deployer: SignerWithAddress;
    let pauser: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    before(async () => {
        [deployer, pauser, user1, user2] = await ethers.getSigners();
        tokenFactory = await ethers.getContractFactory("ERC20BaseMock");
    });

    async function deployToken(): Promise<{ token: Contract }> {
        const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
        await token.deployed();
        return { token };
    }

    async function deployAndConfigureToken(): Promise<{ token: Contract }> {
        const { token } = await deployToken();
        await proveTx(token.connect(deployer).setPauser(pauser.address));
        return { token };
    }

    describe("Function 'initialize()'", async () => {
        it("Configures the contract as expected", async () => {
            const { token } = await setUpFixture(deployToken);
            expect(await token.name()).to.equal(TOKEN_NAME);
            expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
            expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
            expect(await token.owner()).to.equal(deployer.address);
            expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
            expect(await token.rescuer()).to.equal(ethers.constants.AddressZero);
            expect(await token.blacklister()).to.equal(ethers.constants.AddressZero);
        });

        it("Is reverted if called for the second time", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });

        it("Is reverted if the implementation contract is called even for the first time", async () => {
            const tokenImplementation: Contract = await tokenFactory.deploy();
            await tokenImplementation.deployed();
            await expect(tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });

        it("Is reverted if the internal initializer is called outside of the init process", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
            );
        });

        it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.call_parent_initialize_unchained()).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
            );
        });
    });

    describe("Function 'transfer()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await expect(token.connect(user1).transfer(user2.address, TOKEN_AMOUNT))
                .to.changeTokenBalances(token, [user1, user2, token], [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0])
                .and.to.emit(token, EVENT_NAME_TRANSFER)
                .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(pauser).pause());
            await expect(token.connect(user1).transfer(user2.address, TOKEN_AMOUNT)).to.be.revertedWith(
                REVERT_MESSAGE_PAUSABLE_PAUSED
            );
        });

        it("Is reverted if the caller is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(token.connect(user1).transfer(user2.address, TOKEN_AMOUNT)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_BLACKLISTED_ACCOUNT
            );
        });

        it("Is reverted if the recipient is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user2).selfBlacklist());
            await expect(token.connect(user1).transfer(user2.address, TOKEN_AMOUNT)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_BLACKLISTED_ACCOUNT
            );
        });
    });

    describe("Function 'approve()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            const oldAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(TOKEN_ALLOWANCE));
            await expect(token.connect(user1).approve(user2.address, TOKEN_ALLOWANCE))
                .to.emit(token, EVENT_NAME_APPROVAL)
                .withArgs(user1.address, user2.address, TOKEN_ALLOWANCE);
            const newActualAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            expect(newActualAllowance).to.equal(newExpectedAllowance);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(pauser).pause());
            await expect(token.connect(user1).approve(user2.address, TOKEN_ALLOWANCE)).to.be.revertedWith(
                REVERT_MESSAGE_PAUSABLE_PAUSED
            );
        });

        it("Is reverted if the caller is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(token.connect(user1).approve(user2.address, TOKEN_ALLOWANCE)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_BLACKLISTED_ACCOUNT
            );
        });

        it("Is reverted if the spender is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user2).selfBlacklist());
            await expect(token.connect(user1).approve(user2.address, TOKEN_ALLOWANCE)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_BLACKLISTED_ACCOUNT
            );
        });
    });

    describe("Function 'transferFrom()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user1).approve(user2.address, TOKEN_AMOUNT));
            await expect(token.connect(user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT))
                .to.changeTokenBalances(token, [user1, user2], [-TOKEN_AMOUNT, TOKEN_AMOUNT])
                .and.to.emit(token, EVENT_NAME_TRANSFER)
                .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(user1).approve(user2.address, TOKEN_AMOUNT));
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(pauser).pause());
            await expect(
                token.connect(user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT)
            ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
        });

        it("Is reverted if the sender is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user1).approve(user2.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user2).selfBlacklist());
            await expect(
                token.connect(user2).transferFrom(deployer.address, user2.address, TOKEN_AMOUNT)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });

        it("Is reverted if the recipient is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(deployer).mintForTest(user1.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user1).approve(user2.address, TOKEN_AMOUNT));
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(
                token.connect(user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });
    });

    describe("Function 'increaseAllowance()'", async () => {
        const initialAllowance: number = TOKEN_ALLOWANCE;
        const allowanceAddedValue: number = TOKEN_ALLOWANCE + 1;

        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).approve(user2.address, initialAllowance));
            const oldAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(allowanceAddedValue));
            await expect(token.connect(user1).increaseAllowance(user2.address, allowanceAddedValue))
                .to.emit(token, EVENT_NAME_APPROVAL)
                .withArgs(user1.address, user2.address, initialAllowance + allowanceAddedValue);
            const newActualAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            expect(newActualAllowance).to.equal(newExpectedAllowance);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(pauser).pause());
            await expect(token.increaseAllowance(user1.address, allowanceAddedValue)).to.be.revertedWith(
                REVERT_MESSAGE_PAUSABLE_PAUSED
            );
        });

        it("Is reverted if the caller is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(
                token.connect(user1).increaseAllowance(user2.address, allowanceAddedValue)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });

        it("Is reverted if the spender is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user2).selfBlacklist());
            await expect(
                token.connect(user1).increaseAllowance(user2.address, allowanceAddedValue)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });
    });

    describe("Function 'decreaseAllowance()'", async () => {
        const initialAllowance: number = TOKEN_ALLOWANCE + 1;
        const allowanceSubtractedValue: number = TOKEN_ALLOWANCE;

        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).approve(user2.address, initialAllowance));
            const oldAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            const newExpectedAllowance: BigNumber = oldAllowance.sub(BigNumber.from(allowanceSubtractedValue));
            await expect(token.connect(user1).decreaseAllowance(user2.address, allowanceSubtractedValue))
                .to.emit(token, EVENT_NAME_APPROVAL)
                .withArgs(user1.address, user2.address, initialAllowance - allowanceSubtractedValue);
            const newActualAllowance: BigNumber = await token.allowance(user1.address, user2.address);
            expect(newActualAllowance).to.equal(newExpectedAllowance);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(user1).approve(user2.address, initialAllowance));
            await proveTx(token.connect(pauser).pause());
            await expect(
                token.connect(user1).decreaseAllowance(user2.address, allowanceSubtractedValue)
            ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
        });

        it("Is reverted if the caller is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).approve(user2.address, initialAllowance));
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(
                token.connect(user1).decreaseAllowance(user2.address, allowanceSubtractedValue)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });

        it("Is reverted if the spender is blacklisted", async () => {
            const { token } = await setUpFixture(deployToken);
            await proveTx(token.connect(user1).approve(user2.address, initialAllowance));
            await proveTx(token.connect(user1).selfBlacklist());
            await expect(
                token.connect(user1).decreaseAllowance(user2.address, allowanceSubtractedValue)
            ).to.be.revertedWithCustomError(token, REVERT_ERROR_BLACKLISTED_ACCOUNT);
        });
    });
});
