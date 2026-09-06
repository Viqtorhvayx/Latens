import type { Hash, PublicClient } from "viem";

export async function waitForConfirmation(publicClient: PublicClient, hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Transaction reverted on-chain — nothing changed. Refresh and check your balances before retrying.");
  }
}
