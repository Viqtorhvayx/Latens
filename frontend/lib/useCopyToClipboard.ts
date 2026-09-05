import { useState } from "react";

export function useCopyToClipboard(resetAfterMs = 1500) {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), resetAfterMs);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions) — fail quietly,
      // the text is still visible and selectable for a manual copy.
    }
  }

  return { copied, copy };
}
