/** CAIP-2 chain ids used in the cross-app envelope (§10). Verify against the CAIP registry before mainnet. */
export const CHAINS = {
  solanaDevnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  solanaMainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  hederaTestnet: "hedera:testnet",
  hederaMainnet: "hedera:mainnet",
  seiTestnet: "eip155:1328",
  seiMainnet: "eip155:1329",
} as const;

export type Cluster = "devnet" | "mainnet";

export function solanaChain(cluster: Cluster): string {
  return cluster === "mainnet" ? CHAINS.solanaMainnet : CHAINS.solanaDevnet;
}

/** CAIP-10 account id: `<namespace>:<reference>:<address>`. */
export function caip10(chain: string, address: string): string {
  return `${chain}:${address}`;
}

export function parseCaip10(id: string): { chain: string; address: string } {
  const i = id.lastIndexOf(":");
  const chain = id.slice(0, i);
  if (i < 0 || !/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(chain)) throw new Error(`not a CAIP-10 account: ${id}`);
  return { chain, address: id.slice(i + 1) };
}

export function explorerTx(sig: string, cluster: Cluster): string {
  return cluster === "mainnet"
    ? `https://solscan.io/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
