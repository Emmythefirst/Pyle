/**
 * Real MPC round trip against live devnet cluster 456 -- not a mock, not a
 * local simulation. Uses a throwaway wallet generated per run (never
 * touches wallet A/B/C or the live demo's credential state) and plain
 * node:assert rather than a test-runner framework, since this workspace is
 * deliberately dependency-light (progress.md §12's sha2/digest version
 * conflict with the rest of the project).
 *
 * Run with: npx tsx tests/check-eligibility.test.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "node:assert/strict";
import { initCheckEligibilityCompDefIfNeeded, initEligibilityAccountsIfNeeded, checkEligibility } from "../client/check-eligibility";

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const mainPayer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));

  const testWallet = Keypair.generate();
  console.log("throwaway test wallet:", testWallet.publicKey.toBase58());

  const fundTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: mainPayer.publicKey, toPubkey: testWallet.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  fundTx.recentBlockhash = blockhash;
  fundTx.feePayer = mainPayer.publicKey;
  fundTx.sign(mainPayer);
  const fundSig = await connection.sendRawTransaction(fundTx.serialize());
  await connection.confirmTransaction({ signature: fundSig, blockhash, lastValidBlockHeight }, "confirmed");

  const idl = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../target/idl/eligibility_mpc.json"), "utf-8"),
  );
  const mainProvider = new AnchorProvider(connection, new anchor.Wallet(mainPayer), { commitment: "confirmed" });
  const mainProgram = new Program(idl as Idl, mainProvider);
  await initCheckEligibilityCompDefIfNeeded(mainProgram, mainProvider, mainPayer.publicKey);

  const walletProvider = new AnchorProvider(connection, new anchor.Wallet(testWallet), { commitment: "confirmed" });
  const walletProgram = new Program(idl as Idl, walletProvider);
  await initEligibilityAccountsIfNeeded(walletProgram, walletProvider, testWallet.publicKey);

  console.log("\ncase A: income $250k, net worth $50k -- expect eligible=true (qualifies on income alone)");
  const resultA = await checkEligibility(250_000n, 50_000n, walletProgram, walletProvider, testWallet.publicKey);
  assert.equal(resultA.eligible, true, `expected eligible=true, got ${resultA.eligible}`);
  console.log("  PASS -- finalize sig:", resultA.finalizeSig);

  console.log("\ncase B: income $60k, net worth $100k -- expect eligible=false (neither threshold met)");
  const resultB = await checkEligibility(60_000n, 100_000n, walletProgram, walletProvider, testWallet.publicKey);
  assert.equal(resultB.eligible, false, `expected eligible=false, got ${resultB.eligible}`);
  console.log("  PASS -- finalize sig:", resultB.finalizeSig);

  console.log("\nALL MPC TESTS PASSED");
}

main().catch((err) => {
  console.error("MPC TEST FAILED:", err);
  process.exit(1);
});
