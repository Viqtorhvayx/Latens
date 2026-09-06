import Image from "next/image";

const TOKEN_LOGOS: Record<string, string> = {
  ZEN: "/tokens/zen.png",
  ZUSD: "/tokens/zusd.png",
  WBTC: "/tokens/wbtc.png",
  USDC: "/tokens/usdc.png",
};

export function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const src = TOKEN_LOGOS[symbol];

  if (src) {
    return <Image src={src} alt={symbol} width={size} height={size} className="shrink-0 rounded-full" />;
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-gold"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {symbol[0]}
    </div>
  );
}
