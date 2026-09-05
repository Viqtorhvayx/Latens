import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-8 text-center">
      <Logo size={40} />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">404</p>
        <h1 className="font-display text-3xl font-medium">This page doesn&apos;t exist.</h1>
        <p className="text-sm text-ink-muted">Check the address, or head back to somewhere that does.</p>
      </div>
      <Link
        href="/"
        className="rounded-[10px] bg-gold px-6 py-3 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong"
      >
        Back to home
      </Link>
    </div>
  );
}
