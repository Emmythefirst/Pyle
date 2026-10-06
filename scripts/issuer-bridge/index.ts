/**
 * scripts/issuer-bridge/index.ts
 *
 * The missing link between the two halves of Pyle's compliance system
 * (progress.md §12.10):
 *
 *   eligibility-mpc   -- privately computes eligibility via Arcium MPC,
 *                        stores the revealed result in EligibilityAttestation,
 *                        emits EligibilityComputedEvent. Never sees or stores
 *                        income/net_worth past the computation itself.
 *   eligibility-credential -- issues the real, on-chain EligibilityCredential
 *                        that transfer-hook actually checks on every DBC buy.
 *
 * Nothing currently connects them: issue_credential still has to be called
 * by hand. This script is that connection -- today a standalone script
 * (watch mode below), later the backend/ service per progress.md §3. It
 * reads a wallet's EligibilityAttestation and, if eligible, issues the real
 * credential -- the issuer here stands in for "whoever is authorized to act
 * on a verified-private MPC result," same stand-in role described in
 * eligibility-credential's own IssuerConfig docs.
 */

import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
// anchor.BN is undefined under true ESM here (a CJS/ESM interop gap in
// @coral-xyz/anchor's package exports, not a logic bug) -- import BN
// directly instead, same workaround scripts/eligibility-test already uses.
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Must byte-for-byte match eligibility-credential's POLICY_US_ACCREDITED
// const: b"US_ACCREDITED" zero-padded to 32 bytes (same literal used
// throughout scripts/eligibility-test and arcium-mpc/client).
const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);
const ONE_YEAR_SECS = 365 * 24 * 60 * 60;

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function credentialPda(programId: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    programId,
  )[0];
}

function attestationPda(programId: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility-attestation"), wallet.toBuffer()],
    programId,
  )[0];
}

async function ensureIssuerConfigured(
  credentialProgram: Program<Idl>,
  issuerKey: PublicKey,
): Promise<PublicKey> {
  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    credentialProgram.programId,
  );
  const existing = await credentialProgram.provider.connection.getAccountInfo(issuerConfigPda);
  if (!existing) {
    await (credentialProgram.methods as never as { configureIssuer: () => { accounts: (a: unknown) => { rpc: () => Promise<string> } } })
      .configureIssuer()
      .accounts({
        issuer: issuerKey,
        newIssuer: issuerKey,
        issuerConfig: issuerConfigPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("[ok] configure_issuer: payer is now issuer");
  }
  return issuerConfigPda;
}

export interface BridgeResult {
  wallet: PublicKey;
  attestationFound: boolean;
  eligible: boolean;
  issued: boolean;
  credentialSig?: string;
}

/**
 * Reads `wallet`'s EligibilityAttestation (written by eligibility-mpc's
 * check_eligibility_v2_callback) and, if eligible, issues the real
 * EligibilityCredential that transfer-hook checks on every DBC buy.
 */
export async function bridgeWallet(
  mpcProgram: Program<Idl>,
  credentialProgram: Program<Idl>,
  issuerKey: PublicKey,
  wallet: PublicKey,
): Promise<BridgeResult> {
  const attestationAddr = attestationPda(mpcProgram.programId, wallet);
  const attestationInfo = await mpcProgram.provider.connection.getAccountInfo(attestationAddr);
  if (!attestationInfo) {
    return { wallet, attestationFound: false, eligible: false, issued: false };
  }

  const attestation = await (
    mpcProgram.account as never as {
      eligibilityAttestation: { fetch: (a: PublicKey) => Promise<{ eligible: boolean }> };
    }
  ).eligibilityAttestation.fetch(attestationAddr);

  if (!attestation.eligible) {
    return { wallet, attestationFound: true, eligible: false, issued: false };
  }

  await ensureIssuerConfigured(credentialProgram, issuerKey);

  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    credentialProgram.programId,
  );
  const credential = credentialPda(credentialProgram.programId, wallet);
  const nowSecs = Math.floor(Date.now() / 1000);

  const credentialSig = await (
    credentialProgram.methods as never as {
      issueCredential: (
        policyId: number[],
        expiresAt: BN,
      ) => { accounts: (a: unknown) => { rpc: () => Promise<string> } };
    }
  )
    .issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(nowSecs + ONE_YEAR_SECS))
    .accounts({
      issuer: issuerKey,
      wallet,
      issuerConfig: issuerConfigPda,
      credential,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  return { wallet, attestationFound: true, eligible: true, issued: true, credentialSig };
}

// ─────────────────────────────────────────────────────────────────────────────
// Watch mode -- subscribes to eligibility-mpc's logs and bridges every
// newly-computed eligible wallet automatically. Same log-subscription
// pattern as arcium-mpc/client/check-eligibility.ts's pollForEligibilityEvent
// (a subscription, not polling, to avoid the public-RPC rate-limit self-DOS
// documented in progress.md §12.9).
// ─────────────────────────────────────────────────────────────────────────────

function watch(
  mpcProgram: Program<Idl>,
  credentialProgram: Program<Idl>,
  issuerKey: PublicKey,
): void {
  console.log("Watching for EligibilityComputedEvent... (Ctrl+C to stop)");
  mpcProgram.provider.connection.onLogs(
    mpcProgram.programId,
    async (logs) => {
      for (const line of logs.logs) {
        if (!line.startsWith("Program data: ")) continue;
        let decoded;
        try {
          decoded = mpcProgram.coder.events.decode(line.slice("Program data: ".length));
        } catch {
          continue;
        }
        if (decoded?.name !== "eligibilityComputedEvent") continue;

        const { wallet, eligible } = decoded.data as { wallet: PublicKey; eligible: boolean };
        console.log(`\nEligibilityComputedEvent: wallet=${wallet.toBase58()} eligible=${eligible}`);
        if (!eligible) {
          console.log("  not eligible -- nothing to do");
          continue;
        }
        try {
          const result = await bridgeWallet(mpcProgram, credentialProgram, issuerKey, wallet);
          console.log(
            `  issue_credential sig: ${result.credentialSig} -- ${wallet.toBase58()} now holds a real credential`,
          );
        } catch (err) {
          console.error(`  FAILED to issue credential for ${wallet.toBase58()}:`, err);
        }
      }
    },
    "confirmed",
  );
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("payer (issuer):", payer.publicKey.toBase58());

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const mpcIdl = loadIdl(
    path.resolve(import.meta.dirname, "../../arcium-mpc/target/idl/eligibility_mpc.json"),
  );
  const mpcProgram = new anchor.Program(mpcIdl as Idl, provider);

  const credentialIdl = loadIdl(
    path.resolve(import.meta.dirname, "../../target/idl/eligibility_credential.json"),
  );
  const credentialProgram = new anchor.Program(credentialIdl as Idl, provider);

  if (process.argv.includes("--watch")) {
    watch(mpcProgram, credentialProgram, payer.publicKey);
    await new Promise(() => {}); // run forever
    return;
  }

  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  const wallet = walletArg ? new PublicKey(walletArg.split("=")[1]) : payer.publicKey;

  console.log(`\nBridging wallet: ${wallet.toBase58()}`);
  const result = await bridgeWallet(mpcProgram, credentialProgram, payer.publicKey, wallet);

  if (!result.attestationFound) {
    console.log("RESULT: no EligibilityAttestation found for this wallet -- run check_eligibility first.");
  } else if (!result.eligible) {
    console.log("RESULT: wallet's attestation says eligible=false -- not issuing a credential.");
  } else {
    console.log(`RESULT: eligible=true -- issue_credential sig: ${result.credentialSig}`);
    console.log("This wallet now holds a real EligibilityCredential that transfer-hook will accept.");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
