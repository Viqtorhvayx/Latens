// Traced (not redrawn) from the mark supplied for the rebrand — three overlapping blade
// shapes. viewBox keeps the mark's own proportions; default preserveAspectRatio ("xMidYMid
// meet") centers and scales it into whatever square `size` the caller asks for, unstretched.
//
// Two renderings of the same three paths. Filled is the working mark: at nav and favicon
// sizes an outline spends the few pixels available drawing both edges of every blade rather
// than the blade itself, so it goes soft and the wordmark starts to outweigh it. Outlined is
// the large-format treatment — lighter, more precise — and it only holds together with room
// to breathe. Hence the size-keyed default, with `variant` to override where size isn't the
// right signal (an outline on a light background, say).
//
// strokeWidth is in the pre-scale coordinate system (the group scales by 0.1) and is
// deliberately not proportional: a stroke that looks right at 400px renders as a sub-pixel
// hairline at 96px, so this is weighted for the 96-200px range the outline is used at.
export function Logo({ size = 32, variant }: { size?: number; variant?: "filled" | "outline" }) {
  const outlined = variant ? variant === "outline" : size >= 64;
  const paint = outlined
    ? { fill: "none", stroke: "#C9A75C", strokeWidth: 34, strokeLinejoin: "round" as const, strokeLinecap: "round" as const }
    : { fill: "#C9A75C", stroke: "none" };

  return (
    <svg width={size} height={size} viewBox="0 0 333.534368 251.890812" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(-105.465632,383.000000) scale(0.1,-0.1)" {...paint}>
        <path d="M2519 3632 c-145 -109 -311 -234 -369 -278 l-105 -80 -2 -275 c-2 -242 -5 -282 -23 -339 -95 -310 -426 -489 -909 -490 -43 0 -62 -3 -55 -10 6 -6 227 -12 594 -17 645 -7 671 -5 780 51 183 93 300 267 340 506 11 66 28 1130 18 1130 -3 0 -124 -89 -269 -198z" />
        <path d="M3374 3707 l-151 -112 -5 -50 c-3 -27 -6 -357 -7 -732 l-2 -681 63 -4 c35 -3 257 -5 493 -7 237 -1 474 -4 528 -7 53 -2 97 0 97 5 0 11 -25 21 -53 21 -38 0 -179 39 -272 75 -207 80 -388 230 -464 385 -69 142 -71 160 -70 718 0 272 -1 495 -3 497 -1 2 -71 -47 -154 -108z" />
        <path d="M2993 3704 l-143 -105 0 -382 c0 -415 -9 -559 -41 -664 -62 -201 -208 -365 -380 -428 l-64 -23 -3 -173 -3 -174 73 -42 c40 -22 213 -122 383 -221 l310 -181 6 82 c10 124 20 2417 12 2416 -5 0 -72 -48 -150 -105z" />
      </g>
    </svg>
  );
}
