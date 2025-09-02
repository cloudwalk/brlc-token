import { ethers, network } from "hardhat";
import { BaseContract, BlockTag, Contract, TransactionReceipt, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export async function proveTx(txResponsePromise: Promise<TransactionResponse>): Promise<TransactionReceipt> {
  const txResponse = await txResponsePromise;
  const txReceipt = await txResponse.wait();
  if (!txReceipt) {
    throw new Error("The transaction receipt is empty");
  }
  return txReceipt;
}

export function connect(contract: BaseContract, signer: HardhatEthersSigner): Contract {
  return contract.connect(signer) as Contract;
}

export function getAddress(contract: Contract): string {
  const address = contract.target;
  if (typeof address !== "string" || address.length != 42 || !address.startsWith("0x")) {
    throw new Error("The '.target' field of the contract is not an address string");
  }
  return address;
}

export async function getTxTimestamp(tx: Promise<TransactionResponse>): Promise<number> {
  const receipt = await proveTx(tx);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return Number(block?.timestamp ?? 0);
}

export async function getBlockTimestamp(blockTag: BlockTag): Promise<number> {
  const block = await ethers.provider.getBlock(blockTag);
  return block?.timestamp ?? 0;
}

export async function getLatestBlockTimestamp(): Promise<number> {
  return getBlockTimestamp("latest");
}

export async function increaseBlockTimestampTo(target: number) {
  if (network.name === "hardhat") {
    await time.increaseTo(target);
  } else if (network.name === "stratus") {
    await ethers.provider.send("evm_setNextBlockTimestamp", [target]);
    await ethers.provider.send("evm_mine", []);
  } else {
    throw new Error(`Setting block timestamp for the current blockchain is not supported: ${network.name}`);
  }
}

export async function getNumberOfEvents(
  tx: Promise<TransactionResponse>,
  contract: Contract,
  eventName: string,
): Promise<number> {
  const topic = contract.filters[eventName].fragment.topicHash;
  return (await proveTx(tx)).logs.filter(log => log.topics[0] == topic).length;
}
