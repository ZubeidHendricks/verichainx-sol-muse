import { publicKey, type TransactionBuilder, type Umi } from "@metaplex-foundation/umi";
import { fetchAsset, type AssetV1 } from "@metaplex-foundation/mpl-core";
import { SPL_MEMO_PROGRAM_ID } from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";

/** A transaction found by its Solana Pay reference key. */
export type FoundTx = { signature: string; ok: boolean; memos: string[] };

/** What the service needs from Solana. RPC in the app; LiteSVM in tests. */
export interface ChainPort {
  /** Always a fresh read (§7.6: refreshed right before building a transaction). */
  getAsset(asset: string): Promise<AssetV1 | null>;
  latestBlockhash(): Promise<string>;
  /** Every transaction that mentions the reference; anyone can add a reference, so callers check memos. */
  findByReference(reference: string): Promise<FoundTx[]>;
  /** Sends a builder whose signers are all present; returns the base58 signature once confirmed. */
  send(builder: TransactionBuilder): Promise<string>;
  /** Sends a transaction someone else signed (base64); returns the signature once confirmed. */
  sendSigned(base64: string): Promise<string>;
}

export class RpcChain implements ChainPort {
  constructor(private readonly umi: Umi) {}

  async getAsset(asset: string): Promise<AssetV1 | null> {
    try {
      // The asset's own plugins only: collection-level plugins must not count as a listing.
      return await fetchAsset(this.umi, publicKey(asset), { skipDerivePlugins: true, commitment: "confirmed" });
    } catch (e) {
      if (String(e).includes("not found")) return null;
      throw e;
    }
  }

  async latestBlockhash(): Promise<string> {
    return (await this.umi.rpc.getLatestBlockhash({ commitment: "confirmed" })).blockhash;
  }

  async send(builder: TransactionBuilder): Promise<string> {
    const { signature, result } = await builder.sendAndConfirm(this.umi, { confirm: { commitment: "confirmed" } });
    if (result.value.err) throw new Error(`transaction failed: ${JSON.stringify(result.value.err)}`);
    return bs58.encode(signature);
  }

  async sendSigned(base64: string): Promise<string> {
    const tx = this.umi.transactions.deserialize(Buffer.from(base64, "base64"));
    const signature = await this.umi.rpc.sendTransaction(tx, { commitment: "confirmed" });
    const result = await this.umi.rpc.confirmTransaction(signature, {
      strategy: { type: "blockhash", ...(await this.umi.rpc.getLatestBlockhash({ commitment: "confirmed" })) },
      commitment: "confirmed",
    });
    if (result.value.err) throw new Error(`transaction failed: ${JSON.stringify(result.value.err)}`);
    return bs58.encode(signature);
  }

  async findByReference(reference: string): Promise<FoundTx[]> {
    const sigs = await this.umi.rpc.call<{ signature: string; err: unknown }[]>(
      "getSignaturesForAddress", [reference, { limit: 10, commitment: "confirmed" }]);
    const found: FoundTx[] = [];
    for (const s of sigs) {
      const tx = await this.umi.rpc.getTransaction(bs58.decode(s.signature), { commitment: "confirmed" });
      if (!tx) continue;
      const memos = tx.message.instructions
        .filter((ix) => tx.message.accounts[ix.programIndex] === SPL_MEMO_PROGRAM_ID)
        .map((ix) => new TextDecoder().decode(ix.data));
      found.push({ signature: s.signature, ok: s.err == null && tx.meta.err == null, memos });
    }
    return found;
  }
}
