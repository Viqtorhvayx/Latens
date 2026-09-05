import Link from "next/link";
import { Logo } from "./Logo";

export function MarketingNav() {
  return (
    <div className="flex items-center justify-between border-b border-line px-8 py-5 md:px-16">
      <Link href="/" className="flex items-center gap-3">
        <Logo size={32} />
        <span className="font-display text-xl">Latens</span>
      </Link>
      <div className="hidden items-center gap-10 md:flex">
        <a href="#protocol" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Protocol
        </a>
        <a href="#security" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Security
        </a>
        <a href="#roadmap" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Roadmap
        </a>
      </div>
      <Link href="/app/markets" className="rounded-[10px] bg-gold px-6 py-3 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong">
        Launch App
      </Link>
    </div>
  );
}
