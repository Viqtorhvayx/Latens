"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MarketingNav } from "@/components/MarketingNav";
import { MaskedValue } from "@/components/MaskedValue";
import { HealthGauge } from "@/components/HealthGauge";
import { Reveal } from "@/components/Reveal";
import { Logo } from "@/components/Logo";

const problems = [
  {
    title: "Positions are a target",
    body: "A public collateral ratio is a standing invitation — MEV bots watch for the exact block where a position crosses its threshold, and whales get front-run the moment they move.",
  },
  {
    title: "Size leaks strategy",
    body: "Anyone can see what you hold, how leveraged you are, and when you're about to act. For an institution or a fund, that's not a minor inconvenience — it's information a competitor shouldn't have.",
  },
  {
    title: "Privacy and compliance don't have to fight",
    body: "Most \"private\" designs make audits harder. Latens keeps a viewing key in the owner's hands — provably compliant on demand, provably hidden until then.",
  },
];

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
    title: "Repay on your terms",
    body: "Interest compounds automatically into supplier yield — repay whenever suits you. If a position ever does fall under-collateralized, liquidation is checked against the proof alone, never exposed to the market beforehand.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
        <path d="M12 20 L18 26 L28 14" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="20" r="15" stroke="#C9A75C" strokeWidth="1.2" opacity="0.35" />
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
    body: "Built to integrate with Horizen's private DEX, cross-chain bridge, and yield infrastructure as they come online.",
  },
  {
    title: "Selective disclosure, on your terms",
    body: "Hand a viewing key to your own auditor, accountant, or regulator to reveal your position in the clear — without it ever touching the public chain. Confidential and compliant stop being a contradiction.",
  },
];

const trustPoints = [
  {
    title: "Every contract, publicly verifiable",
    body: "Source code for every deployed contract is verified on Etherscan — read exactly what you're trusting, not just what we say it does.",
  },
  {
    title: "Honest about where we are",
    body: "This is a testnet build with permissive proof verification, disclosed on every page. Nothing here is dressed up as more finished than it is.",
  },
  {
    title: "Independent audit, before mainnet exposure",
    body: "A third-party security review of the proof system and liquidation logic is scheduled before any real deposits are possible — see the roadmap below.",
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
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute top-[-220px] left-1/2 h-[560px] w-[900px] -translate-x-1/2 opacity-[0.14]"
          style={{ background: "radial-gradient(ellipse at center, #C9A75C 0%, transparent 68%)" }}
        />
        <div className="relative mx-auto flex max-w-[1440px] flex-col gap-16 px-8 py-24 md:flex-row md:items-center md:gap-20 md:px-16 md:py-32">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="flex max-w-[600px] flex-1 flex-col gap-7">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              <span className="text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">Testnet live · Applying to the Thrive Horizen Grant Program</span>
            </div>
            <h1 className="font-display text-5xl leading-[1.06] font-medium tracking-tight md:text-[60px]">Lending, kept between you and the chain.</h1>
            <p className="text-lg leading-relaxed text-ink-muted">
              Latens is a confidential borrow-lend market for Horizen. Collateral, borrow size, and health factor stay provably hidden — verified by zero-knowledge proofs instead of a public ledger.
            </p>
            <div className="mt-2 flex items-center gap-4">
              <Link href="/app/markets" className="rounded-[10px] bg-gold px-6 py-3.5 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong">
                Launch App
              </Link>
              <a href="#docs" className="flex items-center gap-2 rounded-[10px] border border-line-strong px-6 py-3.5 text-[14.5px] font-semibold transition-colors hover:bg-surface-hover">
                Read the litepaper
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M3 11 L11 3 M11 3 H5 M11 3 V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
            <p className="mt-2 text-xs text-ink-faint">Built for Horizen · Base L3 · Thrive Season 2 Builder Ecosystem Fund</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} className="flex flex-1 justify-center">
            <div className="w-full max-w-[420px] rounded-[20px] border border-line bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Your position</span>
                <span className="rounded-full border border-line-strong px-2.5 py-1 text-[10.5px] font-semibold tracking-wide text-ink-faint uppercase">Example</span>
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
      </div>

      {/* PROBLEM */}
      <div className="mx-auto max-w-[1200px] px-8 pb-8 md:px-16">
        <Reveal className="mb-14 max-w-[640px]">
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Why it matters</p>
          <h2 className="mt-3 font-display text-3xl font-medium md:text-4xl">Public lending was never built for size.</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {problems.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08} className="flex flex-col gap-3">
              <span className="font-mono text-[13px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display text-[19px] font-medium">{p.title}</span>
              <p className="text-[14.5px] leading-relaxed text-ink-muted">{p.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div id="protocol" className="mx-auto max-w-[1200px] px-8 py-24 text-center md:px-16">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">How confidential lending works</p>
          <h2 className="mt-3 mb-16 font-display text-3xl font-medium md:text-4xl">Nothing about your position is public — not even to us.</h2>
        </Reveal>
        <div className="flex flex-col gap-12 text-left md:flex-row">
          {steps.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.1} className="flex flex-1 flex-col gap-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-gold/40 font-mono text-[13px] text-gold">{step.n}</span>
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {benefits.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.1} className="rounded-2xl border border-line bg-surface p-7">
              <span className="font-display text-xl">{b.title}</span>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{b.body}</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* SECURITY */}
      <div id="security" className="border-y border-line bg-canvas-raised px-8 py-24 md:px-16">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="mb-14 max-w-[640px]">
            <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Security</p>
            <h2 className="mt-3 font-display text-[32px] font-medium">Confidential doesn&apos;t mean unaccountable.</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {trustPoints.map((t, i) => (
              <Reveal key={t.title} delay={i * 0.08} className="flex flex-col gap-3">
                <span className="font-display text-[18px] font-medium">{t.title}</span>
                <p className="text-[14px] leading-relaxed text-ink-muted">{t.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>

      {/* ROADMAP */}
      <div id="roadmap" className="px-8 py-24 md:px-16">
        <div className="mx-auto max-w-[1200px]">
          <Reveal className="text-center">
            <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Roadmap</p>
            <h2 className="mt-3 mb-16 font-display text-[32px] font-medium">Three milestones to mainnet</h2>
          </Reveal>
          <div className="flex flex-col md:flex-row">
            {milestones.map((m, i) => (
              <Reveal key={m.tag} delay={i * 0.1} className={`flex-1 px-0 py-6 md:px-8 md:py-0 ${i < milestones.length - 1 ? "md:border-r md:border-line" : ""} ${i > 0 ? "md:pl-8" : "md:pl-0"}`}>
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
      <div className="border-t border-line px-8 py-24 text-center md:px-16">
        <Reveal className="mx-auto max-w-[760px]">
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">Ecosystem alignment</p>
          <h2 className="mt-3 mb-5 font-display text-[30px] font-medium">Building inside the Horizen cluster</h2>
          <p className="text-[15.5px] leading-relaxed text-ink-muted">
            Latens is grounded in Horizen&apos;s own assets — ZEN and the natively-issued ZUSD stablecoin sit alongside bridged majors as collateral — and contributes a share of protocol fees to the ZEN staking
            rewards pool, aligning its long-term incentives with the ecosystem it&apos;s built on. Latens is applying to the Thrive Horizen Grant Program (Season 2, Builder Ecosystem Fund) to fund the path to
            mainnet.
          </p>
        </Reveal>
      </div>

      {/* FINAL CTA */}
      <div className="border-t border-line px-8 py-24 text-center md:px-16">
        <Reveal>
          <div className="mb-9 flex justify-center">
            <Logo size={112} variant="outline" />
          </div>
          <h2 className="mb-8 font-display text-[38px] font-medium">Ready to lend without exposure?</h2>
          <Link href="/app/markets" className="rounded-[10px] bg-gold px-8 py-4 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong">
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
            <a href="https://github.com/Viqtorhvayx/Latens" target="_blank" rel="noopener noreferrer" className="text-[13px] text-ink-muted transition-colors hover:text-ink">
              GitHub
            </a>
          </div>
        </div>
        <span className="text-xs text-ink-faint">© 2026 Latens. Built for Horizen.</span>
      </div>
    </div>
  );
}
