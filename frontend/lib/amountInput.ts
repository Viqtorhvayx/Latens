// Keystroke-level sanitizer for amount inputs. Filtering to /[^0-9.]/ alone still lets
// through things like "1.2.3" (parseUnits throws, silently caught to 0n — the Confirm
// button just goes inert with zero explanation) and unlimited decimal places (parseUnits
// SILENTLY ROUNDS "1.1234567" for a 6-decimal token to "1.123457" and submits that instead
// of what was typed, with no feedback). Both cases are prevented here instead of papered
// over after the fact: extra dots are dropped, and typing stops accepting a keystroke once
// the token's own decimal precision is reached.
export function sanitizeAmountInput(raw: string, decimals: number): string {
  let value = raw.replace(/[^0-9.]/g, "");

  const firstDot = value.indexOf(".");
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replaceAll(".", "");
  }

  const [whole, frac] = value.split(".");
  if (frac !== undefined && frac.length > decimals) {
    value = decimals > 0 ? `${whole}.${frac.slice(0, decimals)}` : whole;
  }

  return value;
}
