import fs from "fs";
import path from "path";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient, AccountsType } from "@meteora-ag/dynamic-bonding-curve-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z");
const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey("HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq");
const POLICY_US_ACCREDITED = Buffer.concat([Buffer.from("US_ACCREDITED", "ascii"), Buffer.alloc(32 - "US_ACCREDITED".length)]);
const POLICY_MARKER_PUBKEY = new PublicKey(POLICY_US_ACCREDITED);

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED], ELIGIBILITY_CREDENTIAL_PROGRAM_ID)[0];
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const pool = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../demo-dbc-pool.json"), "utf-8"));
  const dbcPoolAddress = new PublicKey(pool.pool);
  const extraAccountMetasListPda = new PublicKey(pool.extraAccountMetasList);

  const walletA = loadKeypair(path.resolve(import.meta.dirname, "wallet-a-keypair.json"));
  const walletB = loadKeypair(path.resolve(import.meta.dirname, "wallet-b-keypair.json"));

  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");
  function patchResolverFor(buyer: PublicKey) {
    (dbcClient.pool as never as Record<string, unknown>)["getRemainingAccountsForTransferHook"] = async () => {
      const accounts = [
        { pubkey: ELIGIBILITY_CREDENTIAL_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: POLICY_MARKER_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: credentialPda(buyer), isSigner: false, isWritable: false },
        { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: extraAccountMetasListPda, isSigner: false, isWritable: false },
      ];
      return { info: { slices: [{ accountsType: AccountsType.TransferHookBase, length: accounts.length }] }, accounts };
    };
  }

  async function attemptBuy(label: string, buyer: Keypair, amountSol: number) {
    patchResolverFor(buyer.publicKey);
    try {
      const tx = await dbcClient.pool.swap2WithTransferHook({
        owner: buyer.publicKey,
        pool: dbcPoolAddress,
        swapBaseForQuote: false,
        referralTokenAccount: null,
        payer: buyer.publicKey,
        swapMode: 1,
        amountIn: new BN(amountSol * LAMPORTS_PER_SOL),
        minimumAmountOut: new BN(0),
      } as never);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = buyer.publicKey;
      tx.sign(buyer);
      const sig = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      console.log(`RESULT ${label}: SUCCEEDED -- ${sig}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`RESULT ${label}: FAILED (expected for B) -- ${msg.split("\n")[0]}`);
    }
  }

  console.log("=== Wallet A (valid credential), 0.05 SOL -- expect SUCCESS ===");
  await attemptBuy("wallet A", walletA, 0.05);

  console.log("=== Wallet B (no credential), 0.05 SOL -- expect FAILURE ===");
  await attemptBuy("wallet B", walletB, 0.05);

  const poolState = await dbcClient.state.getPool(dbcPoolAddress);
  console.log("quoteReserve (lamports):", poolState?.quoteReserve.toString());
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
