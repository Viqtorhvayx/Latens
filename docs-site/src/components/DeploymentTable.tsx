import React from "react";
// Imported directly from the frontend project rather than copied, so this table can never
// drift out of sync with what's actually deployed — the same deployment.json the app
// itself reads its contract addresses from. Duplicated here rather than imported from
// frontend/lib/chainExplorer.ts: this is a separate project, and a two-entry lookup table
// isn't worth taking on a cross-project dependency for.
import deployment from "../../../frontend/lib/deployment.json";

const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  11155111: "https://sepolia.etherscan.io",
};

function explorerAddressUrl(chainId: number, address: string): string | undefined {
  const base = EXPLORERS[chainId];
  return base ? `${base}/address/${address}` : undefined;
}

export default function DeploymentTable(): React.JSX.Element {
  const chainId = deployment.chainId;
  const contracts = Object.entries(deployment.contracts).flatMap(([name, c]) =>
    "address" in c ? [{ name, address: c.address as string }] : [],
  );
  const tokens = Object.values(deployment.tokens) as { symbol: string; address: string }[];
  const rows = [...contracts, ...tokens.map((t) => ({ name: t.symbol, address: t.address }))];

  return (
    <table>
      <thead>
        <tr>
          <th>Contract</th>
          <th>Address</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const url = explorerAddressUrl(chainId, row.address);
          return (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <code>{row.address}</code>
                  </a>
                ) : (
                  <code>{row.address}</code>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
