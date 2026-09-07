import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/MarketingNav";
import deployment from "@/lib/deployment.json";
import { explorerAddressUrl } from "@/lib/chainExplorer";

export const metadata: Metadata = {
  title: "Documentation — Latens",
  description:
    "How Latens keeps a lending position confidential: the commitment scheme, the three zero-knowledge proofs, the contracts they gate, and an honest account of what is and isn't finished.",
};

const sections = [
  { id: "overview", label: "Overview" },
  { id: "confidential", label: "What's private, what isn't" },
  { id: "proofs", label: "The three proofs" },
  { id: "circuits", label: "The circuits" },
  { id: "contracts", label: "Contracts" },
  { id: "interest", label: "Interest and yield" },
  { id: "stablecoin", label: "Confidential minting" },
  { id: "assets", label: "Assets" },
  { id: "viewing-keys", label: "Viewing keys" },
  { id: "status", label: "Status and limits" },
  { id: "deployment", label: "This deployment" },
];

const proofs = [
  {
    name: "Commitment update",
    used: "Every deposit, withdraw, borrow and repay",
    statement:
      "I know the opening of the old commitment, and the new commitment correctly adds or subtracts the public delta.",
  },
  {
    name: "Solvency",
    used: "Borrow, withdraw",
    statement:
      "This position's collateral and debt, at current public prices, satisfy the LTV threshold — without revealing either amount.",
  },
  {
    name: "Liquidation eligibility",
    used: "Liquidate",
    statement:
      "This position is below the liquidation threshold, and here are the post-liquidation commitments. The hardest of the three.",
  },
];

const contractRows = [
  { name: "LatensPool", role: "Entrypoint for supplyCollateral, withdrawCollateral, borrow, repay and liquidate. Binds every value a proof is checked against before calling a verifier." },
  { name: "AssetRegistry", role: "Public market config, per-asset aggregates and the kinked interest rate model. Owner-governed." },
  { name: "LatensCDP", role: "Confidential stablecoin minting — lock committed collateral, mint LatensDollar against it." },
  { name: "LatensDollar", role: "The protocol's own stablecoin. Minted and burned only by LatensCDP." },
  { name: "ProtocolTreasury", role: "Collects the reserve-factor slice of interest and routes it to ZEN staking and the supply-rewards programme." },
  { name: "SupplyRewards", role: "Epoch-based supplier incentives, topped up from real protocol revenue on every treasury sweep." },
];

const assets = [
  { symbol: "ZEN", note: "Horizen's native gas and staking token. Confirmed native." },
  { symbol: "ZUSD", note: "Horizen Labs' own natively-issued stablecoin. Confirmed native." },
  { symbol: "WBTC", note: "Bridged major named in Horizen's Archon Bridge documentation for EON." },
  { symbol: "USDC", note: "Bridged major named in the same documentation for EON." },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-12">
      <h2 className="font-display text-2xl font-medium md:text-3xl">{title}</h2>
      <div className="mt-5 flex flex-col gap-4 text-[15px] leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

export default function Docs() {
  const chainId = deployment.chainId;
  // MockERC20 is in here as an ABI only — one shared ABI for the four token contracts,
  // with no address of its own — so entries without an address are skipped rather than
  // rendered as a blank row.
  const deployedContracts = Object.entries(deployment.contracts).flatMap(([name, c]) =>
    "address" in c ? [{ name, address: c.address }] : [],
  );
  const deployedTokens = Object.values(deployment.tokens);

  return (
    <div>
      <MarketingNav />

      <div className="mx-auto flex max-w-[1180px] flex-col gap-16 px-8 py-16 md:flex-row md:gap-20 md:px-16 md:py-24">
        {/* TOC */}
        <aside className="md:w-[210px] md:shrink-0">
          <div className="md:sticky md:top-16">
            <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Documentation</p>
            <nav className="mt-5 flex flex-col gap-2.5">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="text-[13.5px] text-ink-muted transition-colors hover:text-ink">
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-12">
          <div>
            <h1 className="font-display text-4xl leading-tight font-medium md:text-[44px]">
              How Latens keeps a position confidential
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-muted">
              Latens is a borrow-lend market where the size of a position is never published. Collateral and debt live on-chain as
              cryptographic commitments, and every action that would normally require reading those balances is gated by a
              zero-knowledge proof instead. This page describes how that works, and is deliberately explicit about what is finished
              and what is not.
            </p>
            <div className="mt-6 rounded-[12px] border border-line bg-canvas-raised px-5 py-4 text-[14px] leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink">Testnet build.</span> The currently deployed instance verifies proofs with a
              permissive mock, and has not been audited. Read{" "}
              <a href="#status" className="text-gold hover:text-gold-strong">
                Status and limits
              </a>{" "}
              before drawing conclusions from anything else here.
            </div>
          </div>

          <Section id="overview" title="Overview">
            <p>
              A conventional lending market publishes every position. Anyone can read how much collateral an address holds, how much
              it has borrowed, and therefore exactly how far it is from liquidation. That is useful for liquidators and corrosive for
              everyone else: it makes large positions a standing target and turns any institution&apos;s balance sheet into public
              information.
            </p>
            <p>
              Latens stores a position&apos;s collateral and debt as Pedersen commitments. The amounts are never written or read in the
              clear — they are opened only inside a proof circuit, which returns a yes-or-no answer about a property (is this position
              solvent? does this new commitment correctly reflect this deposit?) without revealing the values it reasoned over.
            </p>
          </Section>

          <Section id="confidential" title="What's private, what isn't">
            <p>
              Being precise about this matters more than claiming everything is hidden. The privacy guarantee is scoped to{" "}
              <span className="text-ink">who holds how much</span>, not to the market as a whole.
            </p>
            <ul className="flex list-none flex-col gap-3 pl-0">
              <li>
                <span className="font-semibold text-ink">Private:</span> a position&apos;s resting collateral and debt amounts. Never
                stored or read in the clear — only as commitments, opened exclusively inside the circuits.
              </li>
              <li>
                <span className="font-semibold text-ink">Public, on purpose:</span> per-market aggregates (total supplied and
                borrowed), oracle prices, and the ERC-20 transfer amounts that fund each deposit, borrow or repay. A lending market
                needs public liquidity and price data to function at all.
              </li>
              <li>
                <span className="font-semibold text-ink">Public at liquidation:</span> the seized collateral amount and repay amount
                become public the moment a position is liquidated. Keeping those private too is open design space, not something
                claimed here.
              </li>
            </ul>
          </Section>

          <Section id="proofs" title="The three proofs">
            <p>
              Every state-changing call is gated by at least one of three proofs. In each case the contract itself computes or
              fetches every value the proof is checked against — old and new commitments, deltas, asset IDs, live oracle prices — and
              binds them before calling the verifier, so a valid proof from one call can never be replayed against another.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line-strong">
                    <th className="pb-3 pr-4 font-semibold text-ink">Proof</th>
                    <th className="pb-3 pr-4 font-semibold text-ink">Used by</th>
                    <th className="pb-3 font-semibold text-ink">Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {proofs.map((p) => (
                    <tr key={p.name} className="border-b border-line align-top">
                      <td className="py-4 pr-4 font-mono text-[13px] text-gold">{p.name}</td>
                      <td className="py-4 pr-4 text-ink-muted">{p.used}</td>
                      <td className="py-4 text-ink-muted">{p.statement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="circuits" title="The circuits">
            <p>
              The circuits are written in Noir, chosen over Circom mainly for its type system and range-checked arithmetic, which
              removes much of the manual bookkeeping where under-constrained circuit bugs tend to appear. That trades away Circom&apos;s
              cheaper Groth16 verification gas and deeper audit precedent — a deliberate call for a first pass at this design.
            </p>
            <p>
              A shared <span className="font-mono text-[13px] text-gold">latens_common</span> library holds the single{" "}
              <span className="font-mono text-[13px] text-gold">commit()</span> function every circuit uses. Only the commitment-update
              circuit ever writes a commitment; the other two only open commitments it wrote. If that function diverged between
              circuits — even by a different domain separator — every downstream proof would silently stop verifying against real
              on-chain state, so there is exactly one implementation rather than three copies that could drift.
            </p>
            <p>
              Three behaviours of the language were checked empirically with throwaway circuits before the real ones were written,
              rather than assumed: that <span className="font-mono text-[13px] text-gold">u128</span> arithmetic is checked (so
              overflow and underflow fail proving instead of wrapping), that{" "}
              <span className="font-mono text-[13px] text-gold">Field as u128</span> is a truncating cast and therefore unsafe to
              compute balances through, and that an if/else only enforces the constraints of the branch actually taken. The second of
              those invalidated an earlier draft that would have let a withdrawal larger than the balance wrap into a plausible-looking
              new balance.
            </p>
            <p>
              The full prove-and-verify pipeline has been run end to end against a real toolchain, producing a real Solidity verifier
              that is deployed, called with real proofs in tests, and confirmed to reject tampered public inputs.
            </p>
          </Section>

          <Section id="contracts" title="Contracts">
            <div className="mt-1 flex flex-col gap-4">
              {contractRows.map((c) => (
                <div key={c.name} className="flex flex-col gap-1.5 border-l border-line-strong pl-5">
                  <span className="font-mono text-[13.5px] text-gold">{c.name}</span>
                  <span className="text-[14.5px] text-ink-muted">{c.role}</span>
                </div>
              ))}
            </div>
            <p className="mt-2">
              Positions are single-collateral, single-debt-asset and isolated per user. Cross-margin positions would require the
              circuits to aggregate over many assets in one proof, which is materially harder and out of scope for this milestone.
            </p>
          </Section>

          <Section id="interest" title="Interest and yield">
            <p>
              Interest is utilization-driven, not a placeholder. The registry holds a kinked rate model per asset, and repayment
              charges a genuine time-weighted fee computed over the exact elapsed time since the position&apos;s debt was last touched.
            </p>
            <p>
              Suppliers earn a real compounding yield: position commitments encode shares of a per-asset index rather than raw token
              units. Only the reserve-factor slice of a repayment&apos;s interest moves on to the treasury — the rest stays in the pool
              and backs the index&apos;s growth, so withdrawing the same shares later returns more tokens than were deposited. The
              solvency and liquidation circuits value a position at amount × index ÷ RAY before pricing it.
            </p>
            <p>
              The debt side is not index-scaled today. Both circuits accept a debt index generically, but every caller currently passes
              RAY, which is a no-op — matching the flat-fee interest the pool already charged.
            </p>
          </Section>

          <Section id="stablecoin" title="Confidential minting">
            <p>
              LatensCDP applies the same commitment and solvency discipline to stablecoin minting: lock committed collateral, mint
              LatensDollar against it, and pay a one-time origination fee. That fee is the entire revenue mechanism on this path,
              since per-position minted amounts can&apos;t be distributed proportionally without revealing them.
            </p>
            <p>
              It shares the registry&apos;s listed collateral assets and their LTV and liquidation parameters, but keeps its own
              aggregates.
            </p>
          </Section>

          <Section id="assets" title="Assets">
            <p>Four collateral and debt assets, chosen to be actually grounded on Horizen rather than merely recognizable:</p>
            <div className="mt-2 flex flex-col gap-3">
              {assets.map((a) => (
                <div key={a.symbol} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <span className="font-mono text-[13.5px] text-gold sm:w-[64px] sm:shrink-0">{a.symbol}</span>
                  <span className="text-[14.5px] text-ink-muted">{a.note}</span>
                </div>
              ))}
            </div>
            <p className="mt-2">
              A caveat on the two bridged assets: EON is mid-migration to a new Base-settling L3, and the final bridged-asset list for
              that network isn&apos;t published yet. Treat WBTC and USDC as best-available and sourced rather than confirmed. DAI was
              dropped for exactly this reason — it had no Horizen-specific grounding.
            </p>
          </Section>

          <Section id="viewing-keys" title="Viewing keys">
            <p>
              Confidentiality that can&apos;t be lifted on demand is a problem for anyone with an auditor, an accountant or a regulator.
              A viewing key stays in the position owner&apos;s hands and lets them disclose their own position in the clear to a chosen
              party, without that disclosure ever touching the public chain.
            </p>
            <p>
              The point is that the choice belongs to the position owner: hidden by default, provable when they decide it should be.
            </p>
          </Section>

          <Section id="status" title="Status and limits">
            <p>
              This is a working protocol scaffold, not a finished product, and the distinction is worth stating plainly.
            </p>
            <ul className="flex list-none flex-col gap-3 pl-0">
              <li>
                <span className="font-semibold text-ink">No independent audit has been done.</span> A security self-review exists in
                the repository. It is a genuine review, by the same author as the code, and explicitly not a substitute for an
                independent one.
              </li>
              <li>
                <span className="font-semibold text-ink">The deployed testnet instance uses a permissive mock verifier.</span> Real
                generated verifiers for all three proofs exist, compile, are deployed in tests and have been driven end to end —
                including a real borrow and a real liquidation gated by real proofs. The public testnet deployment stays on the mock
                because there is no client-side proof generation in the interface yet, so a real verifier would make every button
                revert.
              </li>
              <li>
                <span className="font-semibold text-ink">The mock verifier must never reach mainnet.</span> There is no on-chain guard
                preventing a misconfigured deployment from using it; that gate belongs in the deploy process and in milestone review.
              </li>
              <li>
                <span className="font-semibold text-ink">Circuit soundness has not been audited.</span> The empirical checks described
                above are real but narrow. A circuit audit is a different discipline from a Solidity review, and neither has been done
                independently.
              </li>
            </ul>
          </Section>

          <Section id="deployment" title="This deployment">
            <p>
              Every contract below is deployed and source-verified on the public explorer, so the code being described here can be
              read directly rather than taken on trust.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line-strong">
                    <th className="pb-3 pr-4 font-semibold text-ink">Contract</th>
                    <th className="pb-3 font-semibold text-ink">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {[...deployedContracts, ...deployedTokens.map((t) => ({ name: t.symbol, address: t.address }))].map((c) => {
                    const url = explorerAddressUrl(chainId, c.address);
                    return (
                      <tr key={c.name} className="border-b border-line">
                        <td className="py-3.5 pr-4 font-mono text-gold">{c.name}</td>
                        <td className="py-3.5 font-mono break-all text-ink-muted">
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink-muted hover:text-ink">
                              {c.address}
                            </a>
                          ) : (
                            c.address
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="flex flex-col gap-4 border-t border-line pt-12 sm:flex-row sm:items-center">
            <Link
              href="/app/markets"
              className="rounded-[10px] bg-gold px-6 py-3.5 text-center text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong"
            >
              Launch App
            </Link>
            <a
              href="https://github.com/Viqtorhvayx/Latens"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[10px] border border-line-strong px-6 py-3.5 text-center text-[14.5px] font-semibold text-ink transition-colors hover:bg-surface-hover"
            >
              Read the source
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
