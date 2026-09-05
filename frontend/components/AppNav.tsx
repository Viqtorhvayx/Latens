"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWallet } from "./ConnectWallet";
import { Logo } from "./Logo";

const links = [
  { href: "/app/markets", label: "Markets" },
  { href: "/app/portfolio", label: "Portfolio" },
  { href: "/app/verify", label: "Verify" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between border-b border-line px-12 py-5">
      <div className="flex items-center gap-11">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-display text-[17px]">Latens</span>
        </Link>
        <div className="flex gap-7">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors ${
                pathname === link.href ? "text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <ConnectWallet />
    </div>
  );
}
