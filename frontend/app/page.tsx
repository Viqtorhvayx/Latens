"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MarketingNav } from "@/components/MarketingNav";
import { MaskedValue } from "@/components/MaskedValue";
import { HealthGauge } from "@/components/HealthGauge";
import { Reveal } from "@/components/Reveal";
import { Logo } from "@/components/Logo";

// Scattered across the whole hero, not the disc's own box, since the disc paints after
// this layer and eclipses any star that falls behind it.
const heroStars = [
  { top: "18%", left: "6%", size: 2, duration: 3.4, delay: 0 },
  { top: "34%", left: "13%", size: 1.5, duration: 2.8, delay: 0.6 },
  { top: "62%", left: "4%", size: 2, duration: 3.1, delay: 1.1 },
  { top: "78%", left: "17%", size: 1.5, duration: 2.6, delay: 0.3 },
  { top: "22%", left: "91%", size: 1.5, duration: 3.6, delay: 1.6 },
  { top: "48%", left: "96%", size: 2, duration: 2.9, delay: 0.9 },
  { top: "71%", left: "88%", size: 1.5, duration: 3.3, delay: 0.4 },
  { top: "88%", left: "76%", size: 1.5, duration: 3.0, delay: 1.4 },
  { top: "12%", left: "43%", size: 1.5, duration: 3.5, delay: 2.1 },
  { top: "84%", left: "36%", size: 1.5, duration: 2.7, delay: 1.9 },
];

// Soft light lobes that orbit behind the disc. Only the part of each that reaches past the
// disc's edge is ever visible, so what shows is light spilling around a limb rather than a
// ring drawn on top of one. Every measurement is a fraction of the disc's own diameter
// (--d) rather than a pixel value, so the whole eclipse scales with the viewport in one
// piece: blur radii included, which a fixed-px version would leave behind.
const coronaLobes = [
  { size: 0.709, offset: 0.364, orbit: 15, breathe: 9, blur: 0.073, color: "rgba(224,190,120,0.55)", reverse: false, delay: 0 },
  { size: 0.6, offset: 0.427, orbit: 24, breathe: 13, blur: 0.091, color: "rgba(201,167,92,0.45)", reverse: true, delay: -6 },
  { size: 0.864, offset: 0.332, orbit: 37, breathe: 17, blur: 0.114, color: "rgba(224,190,120,0.30)", reverse: false, delay: -14 },
];

const problems = [
  {
    title: "Positions are a target",
    body: "A public collateral ratio is a standing invitation. MEV bots watch for the exact block where a position crosses its threshold and whales get front-run the moment they move.",
  },
  {
    title: "Size leaks strategy",
    body: "Anyone can see what you hold, how leveraged you are and when you are about to act. For an institution or a fund, that is not a minor inconvenience. It is information a competitor should not have.",
  },
  {
    title: "Privacy and compliance",
    body: "Most private designs make an audit harder. Latens keeps a viewing key in the owner's hands, so a position stays hidden by default and can still be proven on demand.",
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
    title: "Borrow or mint",
    body: "Borrow against your collateral or mint the protocol's own stablecoin against it. Either way your health factor is proven safe by a zero-knowledge proof and never published in the clear.",
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
    body: "Interest compounds automatically into supplier yield, so you repay whenever it suits you. If a position ever does fall under-collateralized, liquidation is checked against the proof alone and never exposed to the market beforehand.",
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
    body: "Positions are masked everywhere in the interface until you choose to reveal them. It is not an opt-in setting.",
  },
  {
    title: "Provably solvent",
    body: "The protocol's solvency is verifiable on-chain at all times, even though individual positions are not.",
  },
  {
    title: "Viewing keys",
    body: "Turn one on and every future action also publishes a self-encrypted note on-chain. Share the key with an auditor once and they keep passive access to every note from then on, the same shape as a Zcash viewing key.",
  },
  {
    title: "Verify without trusting us",
    body: "Anyone handed a disclosure can check it on the Verify page, which tests the file against live on-chain state rather than trusting the numbers written inside it.",
  },
];

const trustPoints = [
  {
    title: "Every contract, publicly verifiable",
    body: "Source code for every deployed contract is verified on the block explorer, so you can read exactly what you are trusting.",
  },
  {
    title: "Honest about where we are",
    body: "This is a testnet build with permissive proof verification, disclosed on every page. Nothing here is dressed up as more finished than it is.",
  },
  {
    title: "Independent audit before mainnet",
    body: "A third-party security review of the proof system and liquidation logic is scheduled before any real deposits are possible. See the roadmap below.",
  },
];

const milestones = [
  {
    tag: "M1 · Q1 2027",
    title: "Core privacy capability",
    body: "Confidential deposit, borrow and health-factor proofs live on testnet.",
  },
  {
    tag: "M2 · Q2 2027",
    title: "Independent security audit",
    body: "Third-party review of the proof system and liquidation logic before mainnet exposure.",
  },
  {
    tag: "M3 · Q3 2027",
    title: "Mainnet usage",
    body: "Real deposits and borrows on Horizen, demonstrating product-market fit.",
  },
];

const footerColumns = [
  {
    heading: "Protocol",
    links: [
      { label: "Markets", href: "/app/markets", external: false },
      { label: "Portfolio", href: "/app/portfolio", external: false },
      { label: "Mint", href: "/app/mint", external: false },
      { label: "Liquidations", href: "/app/liquidate", external: false },
      { label: "Verify", href: "/app/verify", external: false },
      { label: "Viewing key", href: "/app/viewing-key", external: false },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation", href: "/docs", external: false },
      { label: "Proof system", href: "/docs#proofs", external: false },
      { label: "Contracts", href: "/docs#deployment", external: false },
      { label: "Status", href: "/docs#status", external: false },
      { label: "GitHub", href: "https://github.com/Viqtorhvayx/Latens", external: true },
    ],
  },
  {
    heading: "Community",
    links: [
      { label: "X", href: "#", external: true },
      { label: "Discord", href: "#", external: true },
    ],
  },
];

// The disc's diameter, and the unit every other measurement in the eclipse is expressed
// in. Capped so it never exceeds the viewport, which is what keeps a full circle a full
// circle instead of something the page edge crops back into an arc.
const ECLIPSE_DIAMETER = "min(1400px, 94vw)";

export default function Home() {
  return (
    <div>
      <MarketingNav />

      {/* HERO */}
      {/* overflow-x-clip, not overflow-hidden: the disc has to keep overflowing downward
          past the hero, but the grain layer spreads 40% wider than the disc and would push
          out a horizontal scrollbar. Clipping one axis while the other stays visible is
          exactly the case `clip` exists for; `hidden` would force the vertical axis to
          scroll and crop the disc again. */}
      <div className="relative overflow-x-clip">
        {/* No overflow clipping here on purpose: the disc is deliberately taller than the
            hero, arcing over the copy at the top and reaching its widest point down in the
            section below. Its width is capped against the viewport instead, so nothing
            spills sideways and no horizontal scrollbar appears. */}
        <div className="hero-eclipse pointer-events-none absolute inset-0">
          {/* Sky first, so the disc below can eclipse whatever it passes over. */}
          {heroStars.map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-gold-strong"
              style={{
                top: s.top,
                left: s.left,
                width: s.size,
                height: s.size,
                animation: `star-twinkle ${s.duration}s ease-in-out infinite`,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
          <div className="absolute inset-x-0 top-[40px] flex justify-center">
            <div
              className="relative shrink-0"
              style={
                {
                  "--d": ECLIPSE_DIAMETER,
                  width: "var(--d)",
                  height: "var(--d)",
                } as React.CSSProperties
              }
            >
              {coronaLobes.map((lobe, i) => (
                <div
                  key={i}
                  className="absolute inset-0"
                  style={{
                    animation: `eclipse-spin ${lobe.orbit}s linear infinite${lobe.reverse ? " reverse" : ""}`,
                    animationDelay: `${lobe.delay}s`,
                  }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      width: `calc(var(--d) * ${lobe.size})`,
                      height: `calc(var(--d) * ${lobe.size})`,
                      left: "50%",
                      top: "50%",
                      marginLeft: `calc(var(--d) * ${-lobe.size / 2})`,
                      marginTop: `calc(var(--d) * ${-(lobe.size / 2 + lobe.offset)})`,
                      background: `radial-gradient(circle, ${lobe.color} 0%, transparent 70%)`,
                      filter: `blur(calc(var(--d) * ${lobe.blur}))`,
                      animation: `corona-breathe ${lobe.breathe}s ease-in-out infinite`,
                      animationDelay: `${lobe.delay}s`,
                    }}
                  />
                </div>
              ))}
              {/* Grain goes under the disc and spreads wider than it, so it textures the
                  corona only. Over the disc it would lighten the one thing on screen that
                  has to stay darkest: the silhouette reads as a hole in the light, and a
                  lit hole is not one. Faded at its own rim too, since overlay-blending a
                  hard-edged circle over a dark page turns it into a visible disc. */}
              <div
                className="absolute inset-[-40%] rounded-full opacity-[0.07] mix-blend-overlay"
                style={{
                  animation: "grain-shift 0.9s steps(4) infinite",
                  WebkitMaskImage: "radial-gradient(circle, black 35%, transparent 70%)",
                  maskImage: "radial-gradient(circle, black 35%, transparent 70%)",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
                }}
              />
              {/* The eclipsing body, painted last so it occludes everything above. Filled
                  with the page's own background so it reads as a silhouette rather than an
                  object: invisible except where it cuts the light behind it, which is
                  exactly what draws the crisp limb. */}
              <div
                className="absolute inset-0 rounded-full bg-canvas"
                style={{ boxShadow: "0 0 calc(var(--d) * 0.073) calc(var(--d) * 0.009) rgba(201,167,92,0.12)" }}
              />
            </div>
          </div>
        </div>
        <div className="relative mx-auto flex max-w-[1440px] flex-col gap-16 px-8 pt-24 pb-[120px] md:flex-row md:items-center md:gap-20 md:px-16 md:pt-32 md:pb-[180px]">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="flex max-w-[600px] flex-1 flex-col gap-7">
            <h1 className="font-display text-5xl leading-[1.06] font-medium tracking-tight md:text-[60px]">Lending, kept between you and the chain.</h1>
            <p className="text-lg leading-relaxed text-ink-muted">
              Latens is a confidential borrow-lend market for Horizen. Collateral, borrow size and health factor stay provably hidden, verified by zero-knowledge proofs instead of a public ledger.
            </p>
            <div className="mt-2 flex items-center gap-4">
              <Link href="/app/markets" className="rounded-[10px] bg-gold px-6 py-3.5 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-gold-strong">
                Launch App
              </Link>
              <Link href="/docs" className="flex items-center gap-2 rounded-[10px] border border-line-strong px-6 py-3.5 text-[14.5px] font-semibold transition-colors hover:bg-surface-hover">
                Read the docs
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 7 H11 M7.5 3.5 L11 7 L7.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <p className="mt-2 text-xs text-ink-faint">Built for Horizen · Lend, borrow and mint without exposing your position</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} className="flex flex-1 justify-center">
            <div className="w-full max-w-[420px] rounded-[20px] border border-line bg-surface p-8 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Positions</span>
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
      <div className="relative mx-auto max-w-[1200px] px-8 pb-8 md:px-16">
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
      <div id="protocol" className="relative mx-auto max-w-[1200px] px-8 py-24 text-center md:px-16">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.16em] text-gold uppercase">How confidential lending works</p>
          <h2 className="mt-3 mb-16 font-display text-3xl font-medium md:text-4xl">Nothing about your position is public, not even to us.</h2>
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
      <div className="relative mx-auto max-w-[1200px] px-8 pb-24 md:px-16">
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
      <div id="security" className="relative border-y border-line bg-canvas-raised px-8 py-24 md:px-16">
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
            Latens is grounded in Horizen&apos;s own assets. ZEN and the natively-issued ZUSD stablecoin sit alongside bridged majors as collateral, with the same confidential machinery covering lending, borrowing
            and minting the protocol&apos;s own stablecoin.
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
      <div className="border-t border-line px-8 py-16 md:px-16">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-12 md:flex-row md:justify-between">
          <div className="flex items-center gap-3">
            <Logo size={24} />
            <span className="font-display text-[15px]">Latens</span>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:gap-20">
            {footerColumns.map((col) => (
              <div key={col.heading} className="flex flex-col gap-3">
                <span className="text-xs font-semibold tracking-[0.12em] text-ink-faint uppercase">{col.heading}</span>
                {col.links.map((link) =>
                  link.external ? (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13.5px] text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link key={link.label} href={link.href} className="text-[13.5px] text-ink-muted transition-colors hover:text-ink">
                      {link.label}
                    </Link>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-12 flex max-w-[1200px] border-t border-line pt-8">
          <span className="text-xs text-ink-faint">© 2026 Latens. Built for Horizen.</span>
        </div>
      </div>
    </div>
  );
}
