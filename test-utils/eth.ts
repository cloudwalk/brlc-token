import { BaseContract, Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider";

export async function proveTx(txResponsePromise: Promise<TransactionResponse>): Promise<TransactionReceipt> {
  const txReceipt = await txResponsePromise;
  return txReceipt.wait();
}

export function connect(contract: BaseContract, signer: HardhatEthersSigner): Contract {
  return contract.connect(signer) as Contract;
}
