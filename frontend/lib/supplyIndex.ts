// A supply index advances every second an asset has live utilization, and a deposit's share
// delta is derived from it. Reading the index, letting someone sign, and having the pool
// recompute it at mining time therefore gives two different numbers — which is exactly what
// made a deposit into a borrowed-against asset revert with InvalidProof while a deposit into
// an idle one went through, since an idle asset's index doesn't move at all.
//
// LatensPool binds a deposit's share delta as an upper bound rather than an equality (see
// _verifyShareUpdate), so the fix on this side is to claim slightly FEWER shares than the
// amount buys right now: project the index forward, and the claim stays valid for as long
// as the projection covers, instead of for the single second it was read in.
//
// The projection mirrors AssetRegistry.currentSupplyIndexRay exactly.
const BPS_DENOMINATOR = 10_000n;
const SECONDS_PER_YEAR = 31_536_000n;

// How long a prepared deposit stays submittable. Generous on purpose: the cost of
// overshooting is a dust rounding against the depositor (at a 1 bps supply rate this is
// around 1e-9 of the deposit over half an hour), while the cost of undershooting is a
// reverted transaction and a confused user.
export const SUPPLY_INDEX_PROJECTION_SECONDS = 1_800n;

export function projectSupplyIndexRay(indexRay: bigint, supplyRateBps: bigint, elapsedSeconds = SUPPLY_INDEX_PROJECTION_SECONDS): bigint {
  if (supplyRateBps === 0n) return indexRay; // an idle asset's index doesn't move at all
  return indexRay + (indexRay * supplyRateBps * elapsedSeconds) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
}
