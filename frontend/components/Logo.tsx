import Image from "next/image";

// The mark itself is artwork, not a flat vector shape — it carries a starfield, a grain
// pass and a soft crescent glow that a hand-traced path can't stand in for, so it ships as
// a raster and is served at 2x the largest size it renders at. Framed on its outer orbit
// ring, which is what makes it square; the artwork's own background is the canvas colour,
// so it sits flush on the page with no visible plate.
export function Logo({ size = 32 }: { size?: number }) {
  return <Image src="/logo-mark.png" alt="" width={size} height={size} priority className="shrink-0" />;
}
