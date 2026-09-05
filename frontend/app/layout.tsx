import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { DevBuildBanner } from "@/components/DevBuildBanner";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const title = "Latens — Private lending on Horizen";
const description = "Confidential borrow-lend market for Horizen. Collateral, borrow size, and health factor stay provably hidden, verified by zero-knowledge proofs.";

export const metadata: Metadata = {
  // Needed so the auto-generated opengraph-image/apple-icon resolve to absolute URLs in
  // social-preview <meta> tags instead of Next's localhost fallback. Update this once this
  // deployment has a real domain — see the homepage's own "Built for Horizen · Base L3" note
  // about this being pre-mainnet.
  metadataBase: new URL("https://latens.example"),
  title,
  description,
  // opengraph-image.tsx and apple-icon.tsx (both under app/) are picked up automatically by
  // Next's file convention — no need to reference them here, just the text fields.
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full bg-canvas text-ink font-ui antialiased">
        <DevBuildBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
