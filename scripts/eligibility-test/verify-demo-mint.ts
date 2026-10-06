import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const demoMint = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../demo-mint.json"), "utf-8"));
  const mint = new PublicKey(demoMint.mint);
  const treasuryAta = new PublicKey(demoMint.treasuryAta);
  const decimals = demoMint.decimals;

  const walletA = loadKeypair(path.resolve(import.meta.dirname, "wallet-a-keypair.json"));
  const walletB = loadKeypair(path.resolve(import.meta.dirname, "wallet-b-keypair.json"));

  async function attempt(label: string, buyer: PublicKey) {
    const destAta = getAssociatedTokenAddressSync(mint, buyer, false, TOKEN_2022_PROGRAM_ID);
    const ix = await createTransferCheckedWithTransferHookInstruction(
      connection,
      treasuryAta,
      mint,
      destAta,
      payer.publicKey,
      BigInt(1 * 10 ** decimals),
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    const tx = new Transaction().add(ix);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
      console.log(`RESULT ${label}: SUCCEEDED -- ${sig}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`RESULT ${label}: FAILED (expected for B) -- ${msg.split("\n")[0]}`);
    }
  }

  console.log("=== Wallet A (valid credential) -- expect SUCCESS ===");
  await attempt("wallet A", walletA.publicKey);

  console.log("=== Wallet B (no credential) -- expect FAILURE ===");
  await attempt("wallet B", walletB.publicKey);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
