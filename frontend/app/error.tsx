"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-8 text-center">
      <Logo size={40} />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-[0.16em] text-danger uppercase">Error</p>
        <h1 className="font-display text-3xl font-medium">Something went wrong.</h1>
        <p className="text-sm text-ink-muted">This side stayed private, at least — nothing about your position was sent anywhere.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-[10px] bg-gold px-6 py-3 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-[10px] border border-line-strong px-6 py-3 text-[14.5px] font-semibold transition-colors hover:bg-surface-hover"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
