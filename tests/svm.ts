import { fileURLToPath } from "node:url";

import {
  generateSigner,
  lamports,
  publicKey,
  signTransaction,
  transactionBuilder,
  type Signer,
  type Transaction,
  type TransactionBuilder,
} from "@metaplex-foundation/umi";
import { MPL_CORE_PROGRAM_ID, deserializeAssetV1, type AssetV1 } from "@metaplex-foundation/mpl-core";
import {
  SPL_TOKEN_PROGRAM_ID,
  createAccount,
  createIdempotentAssociatedToken,
  findAssociatedTokenPda,
  initializeMint2,
  mintTokensToChecked,
} from "@metaplex-foundation/mpl-toolbox";
import { address, getTransactionDecoder, lamports as kitLamports } from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

import { makeUmi } from "@/lib/solana/umi";

const CORE_SO = fileURLToPath(new URL("./fixtures/mpl_core.so", import.meta.url));

/** An in-process Solana VM with SPL Token, ATA, Memo and the mainnet Metaplex Core binary loaded. */
export class LocalChain {
  readonly svm = new LiteSVM();
  readonly umi = makeUmi("http://127.0.0.1:8899"); // used only to build and sign

  constructor() {
    this.svm.addProgramFromFile(address(MPL_CORE_PROGRAM_ID), CORE_SO);
  }

  fund(...signers: Signer[]) {
    for (const s of signers) this.svm.airdrop(address(s.publicKey), kitLamports(10_000_000_000n));
  }

  blockhash(): string {
    return this.svm.latestBlockhash();
  }

  /** Sends a fully signed transaction; throws with the program logs on failure. */
  submit(tx: Transaction) {
    const res = this.svm.sendTransaction(getTransactionDecoder().decode(this.umi.transactions.serialize(tx)));
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`transaction failed: ${JSON.stringify(res.err())}\n${res.meta().logs().join("\n")}`);
    }
    this.svm.expireBlockhash(); // the next transaction gets a fresh blockhash, so identical ones aren't deduplicated
    return res;
  }

  async send(builder: TransactionBuilder, payer: Signer) {
    const b = builder.setFeePayer(payer).setBlockhash(this.blockhash());
    return this.submit(await signTransaction(b.build(this.umi), b.getSigners(this.umi)));
  }

  asset(id: string): AssetV1 {
    const acc = this.svm.getAccount(address(id));
    if (!acc.exists) throw new Error(`no asset ${id}`);
    return deserializeAssetV1({
      publicKey: publicKey(id), executable: false, owner: publicKey(acc.programAddress),
      lamports: lamports(acc.lamports), data: acc.data,
    });
  }

  tokenBalance(owner: string, mint: string): bigint {
    const ata = findAssociatedTokenPda(this.umi, { owner: publicKey(owner), mint: publicKey(mint) })[0];
    const acc = this.svm.getAccount(address(ata));
    if (!acc.exists) return 0n;
    return new DataView(acc.data.buffer, acc.data.byteOffset + 64, 8).getBigUint64(0, true);
  }

  /** A 6-decimal test USDC mint, with `amount` base units minted to each holder. */
  async createUsdc(payer: Signer, holders: { owner: string; amount: bigint }[]): Promise<string> {
    const mint = generateSigner(this.umi);
    let b = transactionBuilder()
      .add(createAccount(this.umi, {
        newAccount: mint, payer, lamports: lamports(this.svm.minimumBalanceForRentExemption(82n)),
        space: 82, programId: SPL_TOKEN_PROGRAM_ID,
      }))
      .add(initializeMint2(this.umi, { mint: mint.publicKey, decimals: 6, mintAuthority: payer.publicKey, freezeAuthority: null }));
    for (const h of holders) {
      const ata = findAssociatedTokenPda(this.umi, { owner: publicKey(h.owner), mint: mint.publicKey })[0];
      b = b.add(createIdempotentAssociatedToken(this.umi, { payer, ata, owner: publicKey(h.owner), mint: mint.publicKey }));
      if (h.amount > 0n) {
        b = b.add(mintTokensToChecked(this.umi, {
          mint: mint.publicKey, token: ata, mintAuthority: payer, amount: h.amount, decimals: 6,
        }));
      }
    }
    await this.send(b, payer);
    return mint.publicKey;
  }

  /** Mints more test USDC; `authority` is the payer that created the mint. */
  async mintUsdc(mint: string, authority: Signer, owner: string, amount: bigint) {
    const ata = findAssociatedTokenPda(this.umi, { owner: publicKey(owner), mint: publicKey(mint) })[0];
    await this.send(transactionBuilder()
      .add(createIdempotentAssociatedToken(this.umi, { payer: authority, ata, owner: publicKey(owner), mint: publicKey(mint) }))
      .add(mintTokensToChecked(this.umi, { mint: publicKey(mint), token: ata, mintAuthority: authority, amount, decimals: 6 })),
    authority);
  }
}
