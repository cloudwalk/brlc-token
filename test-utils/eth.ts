import { TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider";

export async function proveTx(txResponsePromise: Promise<TransactionResponse>): Promise<TransactionReceipt> {
  const txReceipt = await txResponsePromise;
  return txReceipt.wait();
}
