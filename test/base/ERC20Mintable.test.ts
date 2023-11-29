import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { TransactionResponse } from "@ethersproject/abstract-provider";
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

describe("Contract 'ERC20Mintable'", async () => {
    const TOKEN_NAME = "BRL Coin";
    const TOKEN_SYMBOL = "BRLC";

    const MINT_ALLOWANCE = 1000;
    const TOKEN_AMOUNT = 100;

    const EVENT_NAME_MAIN_MINTER_CHANGED = "MainMinterChanged";
    const EVENT_NAME_MINTER_CONFIGURED = "MinterConfigured";
    const EVENT_NAME_MINTER_REMOVED = "MinterRemoved";
    const EVENT_NAME_MINT = "Mint";
    const EVENT_NAME_BURN = "Burn";
    const EVENT_NAME_TRANSFER = "Transfer";

    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
        "Initializable: contract is already initialized";
    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
    const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
    const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";
    const REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT = "ERC20: mint to the zero address";
    const REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

    const REVERT_ERROR_BLOCKLISTED_ACCOUNT = "BlocklistedAccount";
    const REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER = "UnauthorizedMainMinter";
    const REVERT_ERROR_UNAUTHORIZED_MINTER = "UnauthorizedMinter";
    const REVERT_ERROR_ZERO_BURN_AMOUNT = "ZeroBurnAmount";
    const REVERT_ERROR_ZERO_MINT_AMOUNT = "ZeroMintAmount";
    const REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE = "ExceededMintAllowance";

    let tokenFactory: ContractFactory;
    let deployer: SignerWithAddress;
    let pauser: SignerWithAddress;
    let mainBlocklister: SignerWithAddress;
    let mainMinter: SignerWithAddress;
    let minter: SignerWithAddress;
    let user: SignerWithAddress;

    before(async () => {
        [deployer, pauser, mainBlocklister, mainMinter, minter, user] = await ethers.getSigners();
        tokenFactory = await ethers.getContractFactory("ERC20MintableMock");
    });

    async function deployToken(): Promise<{ token: Contract }> {
        const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
        await token.deployed();
        await proveTx(token.enableBlocklist(true));
        return { token };
    }

    async function deployAndConfigureToken(): Promise<{ token: Contract }> {
        const { token } = await deployToken();
        await proveTx(token.connect(deployer).setPauser(pauser.address));
        await proveTx(token.connect(deployer).setMainBlocklister(mainBlocklister.address));
        await proveTx(token.connect(deployer).updateMainMinter(mainMinter.address));
        await proveTx(token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE));
        return { token };
    }

    describe("Function 'initialize()'", async () => {
        it("Configures the contract as expected", async () => {
            const { token } = await setUpFixture(deployToken);
            expect(await token.owner()).to.equal(deployer.address);
            expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
            expect(await token.mainBlocklister()).to.equal(ethers.constants.AddressZero);
            expect(await token.mainMinter()).to.equal(ethers.constants.AddressZero);
        });

        it("Is reverted if called for the second time", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });

        it("Is reverted if the contract implementation is called even for the first time", async () => {
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

    describe("Function 'updateMainMinter()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.connect(deployer).updateMainMinter(mainMinter.address))
                .to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED)
                .withArgs(mainMinter.address);
            expect(await token.mainMinter()).to.equal(mainMinter.address);
            await expect(token.connect(deployer).updateMainMinter(mainMinter.address)).not.to.emit(
                token,
                EVENT_NAME_MAIN_MINTER_CHANGED
            );
        });

        it("Is reverted if called not by the owner", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.connect(user).updateMainMinter(mainMinter.address)).to.be.revertedWith(
                REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER
            );
        });
    });

    describe("Function 'configureMinter()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(mainMinter).removeMinter(minter.address));
            expect(await token.isMinter(minter.address)).to.equal(false);
            expect(await token.minterAllowance(minter.address)).to.equal(0);
            await expect(token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE))
                .to.emit(token, EVENT_NAME_MINTER_CONFIGURED)
                .withArgs(minter.address, MINT_ALLOWANCE);
            expect(await token.isMinter(minter.address)).to.equal(true);
            expect(await token.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(mainMinter).removeMinter(minter.address));
            await proveTx(token.connect(pauser).pause());
            await expect(
                token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE)
            ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
        });

        it("Is reverted if called not by the main minter", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(mainMinter).removeMinter(minter.address));
            await expect(
                token.connect(user).configureMinter(minter.address, MINT_ALLOWANCE)
            ).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER
            ).withArgs(user.address);
        });
    });

    describe("Function 'removeMinter()'", async () => {
        it("Executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            expect(await token.isMinter(minter.address)).to.equal(true);
            expect(await token.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
            await expect(token.connect(mainMinter).removeMinter(minter.address))
                .to.emit(token, EVENT_NAME_MINTER_REMOVED)
                .withArgs(minter.address);
            expect(await token.isMinter(minter.address)).to.equal(false);
            expect(await token.minterAllowance(minter.address)).to.equal(0);
            await expect(token.connect(mainMinter).removeMinter(minter.address)).not.to.emit(
                token,
                EVENT_NAME_MINTER_REMOVED
            );
        });

        it("Is reverted if called not by the main minter", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await expect(
                token.connect(user).removeMinter(minter.address)
            ).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER
            ).withArgs(user.address);
        });
    });

    describe("Function 'mint()'", async () => {
        describe("Executes as expected and emits the correct events if", async () => {
            async function checkMinting(token: Contract) {
                const oldMintAllowance: BigNumber = await token.minterAllowance(minter.address);
                const newExpectedMintAllowance: BigNumber = oldMintAllowance.sub(BigNumber.from(TOKEN_AMOUNT));
                const tx: TransactionResponse = await token.connect(minter).mint(user.address, TOKEN_AMOUNT);
                await expect(tx).to.emit(token, EVENT_NAME_MINT).withArgs(minter.address, user.address, TOKEN_AMOUNT);
                await expect(tx)
                    .to.emit(token, EVENT_NAME_TRANSFER)
                    .withArgs(ethers.constants.AddressZero, user.address, TOKEN_AMOUNT);
                await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);
                expect(await token.minterAllowance(minter.address)).to.equal(newExpectedMintAllowance);
            }

            it("The caller and destination address are not blocklisted", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await checkMinting(token);
            });

            it("The destination address is blocklisted but the caller is a blocklister", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
                await proveTx(token.connect(user).selfBlocklist());
                await checkMinting(token);
            });
        });

        describe("Is reverted if", async () => {
            it("The contract is paused", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await proveTx(token.connect(pauser).pause());
                await expect(token.connect(minter).mint(user.address, TOKEN_AMOUNT)).to.be.revertedWith(
                    REVERT_MESSAGE_PAUSABLE_PAUSED
                );
            });

            it("The caller is not a minter", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await expect(
                    token.connect(user).mint(user.address, TOKEN_AMOUNT)
                ).to.be.revertedWithCustomError(
                    token,
                    REVERT_ERROR_UNAUTHORIZED_MINTER
                ).withArgs(user.address);
            });

            it("The caller is blocklisted even if the caller is a blocklister", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
                await proveTx(token.connect(minter).selfBlocklist());
                await expect(
                    token.connect(minter).mint(user.address, TOKEN_AMOUNT)
                ).to.be.revertedWithCustomError(
                    token,
                    REVERT_ERROR_BLOCKLISTED_ACCOUNT
                ).withArgs(minter.address);
            });

            it("The destination address is blocklisted and the caller is not a blocklister", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await proveTx(token.connect(user).selfBlocklist());

                await expect(
                    token.connect(minter).mint(user.address, TOKEN_AMOUNT)
                ).to.be.revertedWithCustomError(
                    token,
                    REVERT_ERROR_BLOCKLISTED_ACCOUNT
                ).withArgs(user.address);
            });

            it("The destination address is zero", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await expect(
                    token.connect(minter).mint(ethers.constants.AddressZero, TOKEN_AMOUNT)
                ).to.be.revertedWith(
                    REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT
                );
            });

            it("The mint amount is zero", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await expect(
                    token.connect(minter).mint(user.address, 0)
                ).to.be.revertedWithCustomError(
                    token,
                    REVERT_ERROR_ZERO_MINT_AMOUNT
                );
            });

            it("The mint amount exceeds the mint allowance", async () => {
                const { token } = await setUpFixture(deployAndConfigureToken);
                await expect(
                    token.connect(minter).mint(user.address, MINT_ALLOWANCE + 1)
                ).to.be.revertedWithCustomError(
                    token,
                    REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE
                );
            });
        });
    });

    describe("Function 'burn()'", async () => {
        it("Executes as expected and emits the correct events", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
            const tx: TransactionResponse = await token.connect(minter).burn(TOKEN_AMOUNT);
            await expect(tx).to.emit(token, EVENT_NAME_BURN).withArgs(minter.address, TOKEN_AMOUNT);
            await expect(tx)
                .to.emit(token, EVENT_NAME_TRANSFER)
                .withArgs(minter.address, ethers.constants.AddressZero, TOKEN_AMOUNT);
            await expect(tx).to.changeTokenBalances(
                token,
                [minter, mainMinter, deployer, token],
                [-TOKEN_AMOUNT, 0, 0, 0]
            );
        });

        it("Is reverted if the contract is paused", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
            await proveTx(token.connect(pauser).pause());
            await expect(token.connect(minter).burn(TOKEN_AMOUNT)).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
        });

        it("Is reverted if the caller is not a minter", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(minter).mint(user.address, TOKEN_AMOUNT));
            await expect(
                token.connect(user).burn(TOKEN_AMOUNT)
            ).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_UNAUTHORIZED_MINTER
            ).withArgs(user.address);
        });

        it("Is reverted if the caller is blocklisted", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
            await proveTx(token.connect(minter).selfBlocklist());
            await expect(
                token.connect(minter).burn(TOKEN_AMOUNT)
            ).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_BLOCKLISTED_ACCOUNT
            ).withArgs(minter.address);
        });

        it("Is reverted if the burn amount is zero", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await expect(
                token.connect(minter).burn(0)
            ).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_ZERO_BURN_AMOUNT
            );
        });

        it("Is reverted if the burn amount exceeds the caller token balance", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
            await expect(
                token.connect(minter).burn(TOKEN_AMOUNT + 1)
            ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
        });
    });

    describe("Backward Compatibility functions", async () => {
        it("Function 'updateMasterMinter()' executes as expected and emits the correct event", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.connect(deployer).updateMasterMinter(mainMinter.address))
                .to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED)
                .withArgs(mainMinter.address);
            expect(await token.mainMinter()).to.equal(mainMinter.address);
            await expect(token.connect(deployer).updateMasterMinter(mainMinter.address)).not.to.emit(
                token,
                EVENT_NAME_MAIN_MINTER_CHANGED
            );
        });

        it("Function 'updateMasterMinter()' is reverted if called not by the owner", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.connect(user).updateMasterMinter(mainMinter.address)).to.be.revertedWith(
                REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER
            );
        });
    });
});
