/**
 * client/check-eligibility.ts
 *
 * Private eligibility check via Arcium MPC, adapted from GhostID's
 * client/enroll.ts pattern (/home/emmanuel/Privis/ghostid). Key difference:
 * GhostID's circuits return Enc<Shared, T> (only the requesting client can
 * decrypt the result), so its client code needs RescueCipher.decrypt() on
 * the callback output. Our check_eligibility circuit calls .reveal() inside
 * the circuit instead, so the callback's EligibilityComputedEvent carries a
 * plain `eligible: bool` already -- no client-side decryption of the result
 * needed, only of the *inputs* (income/net_worth), which stay MPC-private.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getArciumProgram,
  uploadCircuit,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumSignerAccAddress,
  deserializeLE,
  RescueCipher,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as path from "path";

// A confirmed transaction isn't necessarily a successful one -- confirmation
// just means it landed on the ledger, with or without an error. Learned this
// the hard way: earlier versions of this script treated "confirmed" as "ok"
// and reported a crashing transaction as "awaiting MPC finalization" for 30
// minutes. Always check `value.err` explicitly.
async function sendAndConfirm(
  provider: AnchorProvider,
  tx: anchor.web3.Transaction,
  payerKey: PublicKey,
  label: string,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payerKey;

  const signedTx = await provider.wallet.signTransaction(tx);
  const sig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: true,
  });
  const result = await provider.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) {
    throw new Error(`${label} failed: ${JSON.stringify(result.value.err)} (sig: ${sig})`);
  }
  console.log(`${label} sig:`, sig);
  return sig;
}

const CLUSTER_OFFSET = 456;
// sha256("check_eligibility_v2")[0..4] as a little-endian u32 -- must match
// arcium_anchor::comp_def_offset("check_eligibility_v2"), computed
// identically on the Rust side (programs/eligibility-mpc/src/lib.rs).
// Verified by computing both sides independently rather than assumed equal.
// _v2 because the original comp-def's on-chain hash went stale when the
// circuit was rebuilt under a newer arcis version -- see progress.md §12.10.
const COMP_DEF_OFFSET_CHECK_ELIGIBILITY = 1061722949;

// ─────────────────────────────────────────────────────────────────────────────
// Comp def initialization
// ─────────────────────────────────────────────────────────────────────────────

export async function initCheckEligibilityCompDefIfNeeded(
  program: Program<Idl>,
  provider: AnchorProvider,
  payerKey: PublicKey,
): Promise<void> {
  const compDefAccount = getCompDefAccAddress(
    program.programId,
    COMP_DEF_OFFSET_CHECK_ELIGIBILITY as never,
  );
  const existing = await provider.connection.getAccountInfo(compDefAccount);
  if (existing) {
    console.log("check_eligibility comp def already exists, skipping...");
    return;
  }

  const mxeAccount = getMXEAccAddress(program.programId);
  const arciumProgram = getArciumProgram(provider);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  console.log("Initializing check_eligibility comp def...");
  await (program as never as { methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: (o: unknown) => Promise<string> } }> })
    .methods.initCheckEligibilityCompDef()
    .accounts({
      compDefAccount,
      payer: payerKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    })
    .rpc({ commitment: "confirmed" });

  const rawCircuit = fs.readFileSync(
    path.resolve(import.meta.dirname, "../build/check_eligibility_v2.arcis"),
  );
  console.log(`Uploading check_eligibility circuit (${rawCircuit.length} bytes)...`);
  await uploadCircuit(
    provider,
    "check_eligibility_v2",
    program.programId,
    rawCircuit,
    true,
    5,
    { skipPreflight: true, preflightCommitment: "confirmed", commitment: "confirmed" },
  );
  console.log("check_eligibility circuit uploaded and finalized.");
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time setup -- see lib.rs's init_eligibility_accounts for why this is
// split out from check_eligibility (progress.md §12.9).
// ─────────────────────────────────────────────────────────────────────────────

export async function initEligibilityAccountsIfNeeded(
  program: Program<Idl>,
  provider: AnchorProvider,
  payerKey: PublicKey,
): Promise<void> {
  const [attestationAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility-attestation"), payerKey.toBuffer()],
    program.programId,
  );
  const existing = await provider.connection.getAccountInfo(attestationAccount);
  if (existing) {
    console.log("eligibility accounts already initialized, skipping...");
    return;
  }

  const tx = await (program as never as { methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { transaction: () => Promise<anchor.web3.Transaction> } }> })
    .methods.initEligibilityAccounts(payerKey)
    .accounts({
      payer: payerKey,
      attestationAccount,
      signPdaAccount: getArciumSignerAccAddress(program.programId),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

  await sendAndConfirm(provider, tx, payerKey, "init_eligibility_accounts");
}

// ─────────────────────────────────────────────────────────────────────────────
// Check eligibility
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckEligibilityResult {
  attestationAccount: PublicKey;
  checkSig: string;
  finalizeSig: string;
  eligible: boolean;
}

export async function checkEligibility(
  income: bigint,
  netWorth: bigint,
  program: Program<Idl>,
  provider: AnchorProvider,
  payerKey: PublicKey,
): Promise<CheckEligibilityResult> {
  const mxePublicKey = await getMXEPublicKey(provider, program.programId);

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

  const cipher = new RescueCipher(sharedSecret);
  const nonceArr = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonceArr);
  const nonce = Buffer.from(nonceArr);
  // income/net_worth stay as independent u64 values -- no packing needed
  // (unlike GhostID's 128-byte-embedding-into-8-u128s scheme).
  const ciphertexts: number[][] = cipher.encrypt([income, netWorth], nonce);

  const [attestationAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility-attestation"), payerKey.toBuffer()],
    program.programId,
  );

  const offsetArr = new Uint8Array(8);
  globalThis.crypto.getRandomValues(offsetArr);
  const computationOffset = new anchor.BN(Buffer.from(offsetArr).toString("hex"), "hex");

  const tx = await (program as never as { methods: Record<string, (...a: unknown[]) => { accountsPartial: (a: unknown) => { transaction: () => Promise<anchor.web3.Transaction> } }> })
    .methods.checkEligibility(
      computationOffset,
      Array.from(ciphertexts[0]),
      Array.from(ciphertexts[1]),
      Array.from(ephemeralPublicKey),
      new anchor.BN(deserializeLE(nonce).toString()),
    )
    .accountsPartial({
      payer: payerKey,
      attestationAccount,
      signPdaAccount: getArciumSignerAccAddress(program.programId),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mxeAccount: getMXEAccAddress(program.programId),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      compDefAccount: getCompDefAccAddress(
        program.programId,
        COMP_DEF_OFFSET_CHECK_ELIGIBILITY as never,
      ),
    })
    .transaction();

  const checkSig = await sendAndConfirm(provider, tx, payerKey, "check_eligibility");

  console.log("Awaiting check_eligibility MPC finalization (up to 10 min)...");
  const { finalizeSig, eligible } = await pollForEligibilityEvent(
    provider,
    program,
    1800000,
  );

  return { attestationAccount, checkSig, finalizeSig, eligible };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event polling -- same resilience pattern as GhostID's
// pollComputationFinalization / parseBiometricEnrolledEvent. That pattern
// re-fetches up to 40 signatures *and* a getTransaction per signature every
// 1.5s -- against the public devnet RPC this self-inflicts a 429 storm
// (reproduced directly: a single run burned through 100+ rate-limited
// retries without ever getting through). A log subscription avoids polling
// entirely -- one request to open, then the RPC pushes new logs to us.
// ─────────────────────────────────────────────────────────────────────────────

async function pollForEligibilityEvent(
  provider: AnchorProvider,
  program: Program<Idl>,
  timeoutMs: number,
): Promise<{ finalizeSig: string; eligible: boolean }> {
  return new Promise((resolve, reject) => {
    let subId: number | null = null;
    const timer = setTimeout(() => {
      if (subId !== null) provider.connection.removeOnLogsListener(subId).catch(() => {});
      reject(new Error("Computation did not finalize within timeout"));
    }, timeoutMs);

    subId = provider.connection.onLogs(
      program.programId,
      (logs) => {
        const decoded = findEligibilityComputedEvent(logs.logs, program);
        if (decoded) {
          clearTimeout(timer);
          if (subId !== null) provider.connection.removeOnLogsListener(subId).catch(() => {});
          resolve({ finalizeSig: logs.signature, eligible: decoded.eligible });
        }
      },
      "confirmed",
    );
  });
}

function findEligibilityComputedEvent(
  logs: string[],
  program: Program<Idl>,
): { wallet: PublicKey; eligible: boolean } | null {
  for (const log of logs) {
    if (log.startsWith("Program data: ")) {
      try {
        const decoded = program.coder.events.decode(log.slice("Program data: ".length));
        if (decoded?.name === "eligibilityComputedEvent") {
          return decoded.data as { wallet: PublicKey; eligible: boolean };
        }
      } catch {
        // not our event -- keep scanning
      }
    }
  }
  return null;
}
