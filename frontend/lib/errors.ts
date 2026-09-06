// Turns viem/wagmi errors into short, human copy. Without this, a reverted contract call
// surfaces its FULL message — request args, calldata, RPC URL, docs link, viem version —
// as a multi-paragraph dump in the UI. `err.shortMessage` is viem's own one-line summary;
// we only need to special-case the two things worth a specific, actionable sentence:
// a wallet-rejected signature/transaction, and one of LatensPool's own named reverts.
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const REVERT_MESSAGES: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than zero.",
  InvalidProof: "This didn't match the current on-chain state — try refreshing the page and retrying.",
  AssetNotListed: "This asset isn't listed on the protocol.",
  AssetNotSupported: "This build only supports one collateral asset and one debt asset per position.",
  StaleOraclePrice: "Price data is stale right now — try again in a moment.",
  ExceedsGrantIndicativeRange: "That amount is outside this deployment's configured range.",
  ExceedsMaxFee: "That fee is outside this deployment's configured range.",
  NoActivePosition: "Supply collateral in a market first — rewards need an active position.",
};

export function humanizeError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Rejected in wallet.";
    }
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) return REVERT_MESSAGES[name] ?? `Transaction reverted: ${name}.`;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
