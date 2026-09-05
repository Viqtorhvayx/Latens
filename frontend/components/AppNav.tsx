"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWallet } from "./ConnectWallet";
import { Logo } from "./Logo";

const links = [
  { href: "/app/markets", label: "Markets" },
  { href: "/app/portfolio", label: "Portfolio" },
  { href: "/app/liquidate", label: "Liquidate" },
  { href: "/app/verify", label: "Verify" },
  { href: "/app/viewing-key", label: "Viewing key" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-12 sm:py-5">
      <div className="flex min-w-0 items-center gap-4 sm:gap-11">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={28} />
          <span className="hidden font-display text-[17px] sm:inline">Latens</span>
        </Link>
        {/* Scrolls independently instead of forcing the whole nav (and page) to overflow
            horizontally when all four links don't fit next to the logo and wallet button
            on a narrow viewport. */}
        <div className="flex gap-4 overflow-x-auto sm:gap-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`shrink-0 text-sm font-medium transition-colors ${pathname === link.href ? "text-ink" : "text-ink-muted hover:text-ink"}`}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="shrink-0">
        <ConnectWallet />
      </div>
    </div>
  );
}
