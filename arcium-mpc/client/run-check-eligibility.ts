import * as anchor from "@coral-xyz/anchor";
import { Idl } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  initCheckEligibilityCompDefIfNeeded,
  initEligibilityAccountsIfNeeded,
  checkEligibility,
} from "./check-eligibility";

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("payer:", payer.publicKey.toBase58());

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../target/idl/eligibility_mpc.json"),
      "utf-8",
    ),
  );
  const program = new anchor.Program(idl as Idl, provider);

  console.log("\n=== Initializing check_eligibility comp def (once) ===");
  await initCheckEligibilityCompDefIfNeeded(program, provider, payer.publicKey);

  console.log("\n=== Initializing eligibility accounts (once) ===");
  await initEligibilityAccountsIfNeeded(program, provider, payer.publicKey);

  console.log("\n=== Case A: income $250k (qualifies on income alone) -- expect eligible=true ===");
  const resultA = await checkEligibility(250_000n, 50_000n, program, provider, payer.publicKey);
  console.log("attestation:", resultA.attestationAccount.toBase58());
  console.log("finalize sig:", resultA.finalizeSig);
  console.log("RESULT A: eligible =", resultA.eligible, resultA.eligible === true ? "(correct)" : "(WRONG)");

  console.log("\n=== Case B: income $60k, net worth $100k (neither threshold met) -- expect eligible=false ===");
  const resultB = await checkEligibility(60_000n, 100_000n, program, provider, payer.publicKey);
  console.log("attestation:", resultB.attestationAccount.toBase58());
  console.log("finalize sig:", resultB.finalizeSig);
  console.log("RESULT B: eligible =", resultB.eligible, resultB.eligible === false ? "(correct)" : "(WRONG)");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
