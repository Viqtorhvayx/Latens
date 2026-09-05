"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MarketingNav } from "@/components/MarketingNav";
import { MaskedValue } from "@/components/MaskedValue";
import { HealthGauge } from "@/components/HealthGauge";
import { Reveal } from "@/components/Reveal";
import { Logo } from "@/components/Logo";

const steps = [
  {
    n: 1,
    title: "Deposit",
    body: "Collateral is committed as a cryptographic commitment, not a visible balance.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="14" stroke="#C9A75C" strokeWidth="1.6" />
        <circle cx="20" cy="20" r="4" fill="#C9A75C" />
      </svg>
    ),
  },
  {
    n: 2,
    title: "Borrow",
    body: "Your health factor is proven safe with a zero-knowledge proof — never published in the clear.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
        <path d="M10 24 A12 12 0 0 1 24 10" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 30 A12 12 0 0 0 30 16" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      </svg>
    ),
  },
  {
    n: 3,
    title: "Liquidate, if needed",
    body: "Execution happens against the proof, without revealing your position to the market.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
        <line x1="8" y1="14" x2="32" y2="14" stroke="#C9A75C" strokeWidth="1.6" />
        <path d="M20 14 L20 26 M15 21 L20 26 L25 21" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const benefits = [
  {
    title: "Confidential by default",
    body: "Positions are masked everywhere in the interface until you choose to reveal them — not an opt-in setting.",
  },
  {
    title: "Provably solvent",
    body: "The protocol's solvency is verifiable on-chain at all times, even though individual positions aren't.",
  },
  {
    title: "Composable with the cluster",
    body: "Built to integrate with Horizen's private DEX, cross-chain bridge, and yield infrastructure.",
  },
];

const milestones = [
  {
    tag: "M1 — [Q1 2027]",
    title: "Core privacy capability",
    body: "Confidential deposit, borrow, and health-factor proofs live on testnet.",
  },
  {
    tag: "M2 — [Q2 2027]",
    title: "Independent security audit",
    body: "Third-party review of the proof system and liquidation logic before mainnet exposure.",
  },
  {
    tag: "M3 — [Q3 2027]",
    title: "Mainnet usage",
    body: "Real deposits and borrows on Horizen, demonstrating product-market fit.",
  },
];

export default function Home() {
  return (
    <div>
      <MarketingNav />

      {/* HERO */}
      <div className="mx-auto flex max-w-[1440px] flex-col gap-16 px-8 py-24 md:flex-row md:items-center md:gap-20 md:px-16 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex max-w-[600px] flex-1 flex-col gap-7"
        >
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Private lending on Horizen</p>
          <h1 className="font-display text-5xl leading-[1.06] font-medium tracking-tight md:text-[60px]">
            Lending, kept between you and the chain.
          </h1>
          <p className="text-lg leading-relaxed text-ink-muted">
            Latens is a confidential borrow-lend market for Horizen. Collateral, borrow size, and health
            factor stay provably hidden — verified by zero-knowledge proofs instead of a public ledger.
          </p>
          <div className="mt-2 flex items-center gap-4">
            <Link
              href="/app/markets"
              className="rounded-[10px] bg-gold px-6 py-3.5 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong"
            >
              Launch App
            </Link>
            <a
              href="#docs"
              className="flex items-center gap-2 rounded-[10px] border border-line-strong px-6 py-3.5 text-[14.5px] font-semibold transition-colors hover:bg-surface-hover"
            >
              Read the litepaper
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M3 11 L11 3 M11 3 H5 M11 3 V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Built for Horizen · Base L3 · Thrive Season 2 Builder Fund</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-1 justify-center"
        >
          <div className="w-full max-w-[420px] rounded-[20px] border border-line bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
            <div className="mb-6 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Your position</span>
              <span className="font-mono text-[11px] text-ink-faint">0x4a2f···e91c</span>
            </div>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-ink-faint">Supplied</span>
                <MaskedValue value="12,480.00 ZEN" fontSize={26} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-ink-faint">Borrowed</span>
                <MaskedValue value="4,120.00 USDC" fontSize={26} />
              </div>
              <div className="h-px bg-line" />
              <HealthGauge zone="safe" width={356} />
            </div>
          </div>
        </motion.div>
      </div>

      {/* HOW IT WORKS */}
      <div id="protocol" className="mx-auto max-w-[1200px] px-8 py-24 text-center md:px-16">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">How confidential lending works</p>
          <h2 className="mt-3 mb-16 font-display text-3xl font-medium md:text-4xl">
            Nothing about your position is public — not even to us.
          </h2>
        </Reveal>
        <div className="flex flex-col gap-12 text-left md:flex-row">
          {steps.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.1} className="flex flex-1 flex-col gap-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-gold/40 font-mono text-[13px] text-gold">
                  {step.n}
                </span>
                {step.icon}
              </div>
              <span className="font-display text-[21px] font-medium">{step.title}</span>
              <p className="text-[14.5px] leading-relaxed text-ink-muted">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* BENEFITS */}
      <div className="mx-auto max-w-[1200px] px-8 pb-24 md:px-16">
        <div className="flex flex-col gap-6 md:flex-row">
          {benefits.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.1} className="flex-1 rounded-2xl border border-line bg-surface p-7">
              <span className="font-display text-xl">{b.title}</span>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{b.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* ROADMAP */}
      <div id="roadmap" className="border-y border-line bg-canvas-raised px-8 py-24 md:px-16">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="text-center">
            <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Roadmap</p>
            <h2 className="mt-3 mb-16 font-display text-[32px] font-medium">Three milestones to mainnet</h2>
          </Reveal>
          <div className="flex flex-col md:flex-row">
            {milestones.map((m, i) => (
              <Reveal
                key={m.tag}
                delay={i * 0.1}
                className={`flex-1 px-0 py-6 md:px-8 md:py-0 ${
                  i < milestones.length - 1 ? "md:border-r md:border-line" : ""
                } ${i > 0 ? "md:pl-8" : "md:pl-0"}`}
              >
                <div className="flex flex-col gap-3">
                  <span className="font-mono text-xs text-gold">{m.tag}</span>
                  <span className="font-display text-[19px]">{m.title}</span>
                  <p className="text-[13.5px] leading-relaxed text-ink-muted">{m.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>

      {/* ECOSYSTEM */}
      <div id="security" className="mx-auto max-w-[900px] px-8 py-24 text-center md:px-16">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Ecosystem alignment</p>
          <h2 className="mt-3 mb-5 font-display text-[30px] font-medium">Building inside the Horizen cluster</h2>
          <p className="text-[15.5px] leading-relaxed text-ink-muted">
            Latens contributes a share of protocol fees to the ZEN staking rewards pool, aligning its
            long-term incentives with the ecosystem it&apos;s built on — in partnership with Thrive Protocol.
          </p>
        </Reveal>
      </div>

      {/* FINAL CTA */}
      <div className="border-t border-line px-8 py-24 text-center md:px-16">
        <Reveal>
          <h2 className="mb-8 font-display text-[38px] font-medium">Ready to lend without exposure?</h2>
          <Link
            href="/app/markets"
            className="rounded-[10px] bg-gold px-8 py-4 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong"
          >
            Launch App
          </Link>
        </Reveal>
      </div>

      {/* FOOTER */}
      <div className="flex flex-col gap-8 border-t border-line px-8 py-12 md:flex-row md:items-center md:justify-between md:px-16">
        <div className="flex items-center gap-3">
          <Logo size={24} />
          <span className="font-display text-[15px]">Latens</span>
        </div>
        <div className="flex gap-16">
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Product</span>
            <Link href="/app/markets" className="text-[13px] text-ink-muted transition-colors hover:text-ink">
              Markets
            </Link>
            <Link href="/app/portfolio" className="text-[13px] text-ink-muted transition-colors hover:text-ink">
              Portfolio
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Company</span>
            <a href="#" className="text-[13px] text-ink-muted transition-colors hover:text-ink">
              Litepaper
            </a>
            <a href="#security" className="text-[13px] text-ink-muted transition-colors hover:text-ink">
              Security
            </a>
          </div>
        </div>
        <span className="text-xs text-ink-faint">© 2026 Latens. Built on Horizen.</span>
      </div>
    </div>
  );
}
