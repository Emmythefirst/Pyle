/**
 * client/verify-cli.ts
 *
 * Thin CLI wrapper around check-eligibility.ts so the backend's /verify
 * endpoint (a separate npm workspace, isolated from this one by the
 * sha2/digest version-bucket conflict documented in progress.md §12) can
 * trigger a real MPC eligibility check by spawning a child process instead
 * of importing across workspaces. argv: <A|B|C> <income> <netWorth>.
 * Emits exactly one "RESULT_JSON:{...}" line on stdout for the caller to
 * parse; everything else on stdout/stderr is human-readable progress log,
 * identical to run-check-eligibility.ts's output.
 */
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import BN from "bn.js";
import { initCheckEligibilityCompDefIfNeeded, initEligibilityAccountsIfNeeded, checkEligibility } from "./check-eligibility";

const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey(
  "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
);
const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}

async function main() {
  const [, , walletKey, incomeStr, netWorthStr] = process.argv;
  if (!["A", "B", "C"].includes(walletKey)) {
    throw new Error(`wallet must be A, B, or C (got ${walletKey})`);
  }

  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");

  const mainPayer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const wallet = loadKeypair(
    path.resolve(
      import.meta.dirname,
      `../../scripts/eligibility-test/wallet-${walletKey.toLowerCase()}-keypair.json`,
    ),
  );
  console.log(`checking wallet ${walletKey}:`, wallet.publicKey.toBase58());

  const MIN_BALANCE = 0.02 * LAMPORTS_PER_SOL;
  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < MIN_BALANCE) {
    console.log(`topping up wallet ${walletKey} (balance ${balance} lamports)...`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainPayer.publicKey,
        toPubkey: wallet.publicKey,
        lamports: MIN_BALANCE - balance,
      }),
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = mainPayer.publicKey;
    tx.sign(mainPayer);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  }

  const mpcIdl = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../target/idl/eligibility_mpc.json"), "utf-8"),
  );

  const mainProvider = new AnchorProvider(connection, new anchor.Wallet(mainPayer), {
    commitment: "confirmed",
  });
  const mainProgram = new Program(mpcIdl as Idl, mainProvider);
  await initCheckEligibilityCompDefIfNeeded(mainProgram, mainProvider, mainPayer.publicKey);

  const walletProvider = new AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  const walletProgram = new Program(mpcIdl as Idl, walletProvider);
  await initEligibilityAccountsIfNeeded(walletProgram, walletProvider, wallet.publicKey);

  const income = BigInt(incomeStr || "0");
  const netWorth = BigInt(netWorthStr || "0");
  const result = await checkEligibility(income, netWorth, walletProgram, walletProvider, wallet.publicKey);

  let credentialIssued = false;
  let credentialSig: string | null = null;
  if (result.eligible) {
    const credIdl = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "../../target/idl/eligibility_credential.json"),
        "utf-8",
      ),
    );
    const credProgram = new Program(credIdl as Idl, mainProvider);
    const [issuerConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("issuer-config")],
      ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
    );
    const ONE_YEAR_SECS = 365 * 24 * 60 * 60;
    const nowSecs = Math.floor(Date.now() / 1000);
    credentialSig = await (
      credProgram as never as {
        methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: () => Promise<string> } }>;
      }
    )
      .methods.issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(nowSecs + ONE_YEAR_SECS))
      .accounts({
        issuer: mainPayer.publicKey,
        wallet: wallet.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(wallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    credentialIssued = true;
    console.log("[ok] issue_credential:", credentialSig);
  }

  console.log(
    "RESULT_JSON:" +
      JSON.stringify({
        eligible: result.eligible,
        checkSig: result.checkSig,
        finalizeSig: result.finalizeSig,
        credentialIssued,
        credentialSig,
      }),
  );
}

main().catch((err) => {
  console.error("FATAL:", err);
  console.log(
    "RESULT_JSON:" + JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
  );
  process.exit(1);
});
