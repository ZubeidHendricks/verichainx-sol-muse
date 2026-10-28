import { transactionBuilder, type Signer } from "@metaplex-foundation/umi";
import { SPL_MEMO_PROGRAM_ID } from "@metaplex-foundation/mpl-toolbox";

/** A Memo instruction with the raw UTF-8 text (mpl-toolbox's `addMemo` adds a length prefix). */
export function memoInstruction(text: string, signers: Signer[] = []) {
  return transactionBuilder([{
    instruction: {
      programId: SPL_MEMO_PROGRAM_ID,
      keys: signers.map((s) => ({ pubkey: s.publicKey, isSigner: true, isWritable: false })),
      data: new TextEncoder().encode(text),
    },
    signers,
    bytesCreatedOnChain: 0,
  }]);
}
