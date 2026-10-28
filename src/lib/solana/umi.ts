import { createSignerFromKeypair, type Signer, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";

export function makeUmi(rpcUrl: string): Umi {
  return createUmi(rpcUrl, "confirmed").use(mplCore()).use(mplToolbox());
}

/** Loads a key from a base58 64-byte secret key or a JSON byte array (solana-keygen format). */
export function signerFromSecret(umi: Umi, secret: string): Signer {
  const s = secret.trim();
  const bytes = s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  if (bytes.length !== 64) throw new Error("expected a 64-byte Solana secret key");
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(bytes));
}
