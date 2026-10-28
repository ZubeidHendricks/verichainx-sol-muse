// Downloads the deployed Metaplex Core program from mainnet into tests/fixtures for LiteSVM.
// The SPL programs (Token, ATA, Memo) ship with LiteSVM.
import { existsSync, writeFileSync } from "node:fs";

const RPC = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PROGRAMS = { "mpl_core.so": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" };

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await r.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result.value;
}

for (const [file, id] of Object.entries(PROGRAMS)) {
  const out = new URL(`../tests/fixtures/${file}`, import.meta.url);
  if (existsSync(out) && !process.argv.includes("--force")) continue;
  const program = await rpc("getAccountInfo", [id, { encoding: "jsonParsed" }]);
  const dataAddr = program.data.parsed.info.programData;
  const data = await rpc("getAccountInfo", [dataAddr, { encoding: "base64" }]);
  // ProgramData account: 4-byte tag, 8-byte slot, 1+32-byte optional authority, then the ELF.
  const elf = Buffer.from(data.data[0], "base64").subarray(45);
  if (elf.subarray(0, 4).toString("latin1") !== "\x7fELF") throw new Error(`${id}: not an ELF`);
  writeFileSync(out, elf);
  console.log(`${file}: ${elf.length} bytes from ${dataAddr}`);
}
