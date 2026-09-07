import Link from "next/link";
import { Logo } from "./Logo";
import { DOCS_URL } from "@/lib/docsUrl";

export function MarketingNav() {
  return (
    <div className="flex items-center justify-between border-b border-line px-8 py-5 md:px-16">
      <Link href="/" className="flex items-center gap-3">
        <Logo size={32} />
        <span className="font-display text-xl">Latens</span>
      </Link>
      {/* Root-relative anchors for #protocol/#security/#roadmap: this nav renders on every
          app/* page too, where a bare fragment would look for a section that only exists
          on the landing page. Docs is a fully separate site (docs-site/, built with
          Docusaurus), hence the external link and icon rather than a Link. */}
      <div className="hidden items-center gap-10 md:flex">
        <Link href="/#protocol" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Protocol
        </Link>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Docs
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path d="M3 11 L11 3 M11 3 H5 M11 3 V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <Link href="/#security" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Security
        </Link>
        <Link href="/#roadmap" className="text-sm font-medium text-ink-muted transition-colors hover:text-ink">
          Roadmap
        </Link>
      </div>
      <Link href="/app/markets" className="rounded-[10px] bg-gold px-6 py-3 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong">
        Launch App
      </Link>
    </div>
  );
}
