export function DevBuildBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-line bg-canvas-raised px-6 py-2 text-center text-[12.5px] text-ink-faint">
      <span className="font-semibold text-gold">Testnet build.</span>
      <span>
        Proof verification is a permissive mock, not real zero-knowledge proofs — this deployment has not been
        audited. Don&apos;t use it with real funds.
      </span>
    </div>
  );
}
