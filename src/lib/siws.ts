/** The Sign In With Solana message text (the SIWS ABNF), for wallets that only offer signMessage. */
export type SiwsInput = {
  domain: string; statement?: string; uri?: string; version?: string; chainId?: string;
  nonce?: string; issuedAt?: string; expirationTime?: string;
};

export function siwsMessage(i: SiwsInput, address: string): string {
  const lines = [`${i.domain} wants you to sign in with your Solana account:`, address];
  if (i.statement) lines.push("", i.statement);
  const fields: [string, string | undefined][] = [
    ["URI", i.uri], ["Version", i.version], ["Chain ID", i.chainId], ["Nonce", i.nonce],
    ["Issued At", i.issuedAt], ["Expiration Time", i.expirationTime],
  ];
  const set = fields.filter(([, v]) => v);
  if (set.length) lines.push("", ...set.map(([k, v]) => `${k}: ${v}`));
  return lines.join("\n");
}
