import { parseAbiItem, type PublicClient, type Hex } from "viem";
import { latensPool, tokenList } from "./contracts";
import { decryptNote, publicKeyFromSecretKey } from "./viewingKey";

const VIEWING_NOTE_PUBLISHED = parseAbiItem("event ViewingNotePublished(address indexed user, uint256 indexed assetId, bool isDebt, uint256 timestamp, bytes ciphertext)");

export type DecodedViewingNote = {
  assetId: number;
  symbol: string;
  isDebt: boolean;
  amount: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  decodeFailed: boolean;
};

// Mirrors lib/activity.ts's fetchActivity — same fromBlock:0n caveat applies (fine for this
// local dev chain, a real deployment would want a bounded window or an indexer). The only
// real difference is decryption: every note this address ever published gets fetched
// regardless of whether the caller's key can open it, and one that can't (wrong key, or
// simply not the intended recipient of a note published before this key existed) is
// reported rather than silently dropped, so a viewer can tell "nothing was ever published"
// apart from "I have the wrong key."
export async function fetchAndDecodeViewingNotes(publicClient: PublicClient, address: `0x${string}`, secretKey: Hex): Promise<DecodedViewingNote[]> {
  const publicKey = publicKeyFromSecretKey(secretKey);
  const logs = await publicClient.getLogs({
    address: latensPool.address,
    event: VIEWING_NOTE_PUBLISHED,
    args: { user: address },
    fromBlock: 0n,
    toBlock: "latest",
  });

  const notes: DecodedViewingNote[] = logs.map((log) => {
    const assetId = Number(log.args.assetId!);
    const token = tokenList.find((t) => t.assetId === assetId);
    const decrypted = decryptNote(secretKey, publicKey, log.args.ciphertext! as Hex);
    return {
      assetId,
      symbol: token?.symbol ?? `asset #${assetId}`,
      isDebt: log.args.isDebt!,
      amount: decrypted ? BigInt(decrypted.amount) : 0n,
      timestamp: log.args.timestamp!,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
      decodeFailed: !decrypted,
    };
  });

  notes.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0));
  return notes;
}
