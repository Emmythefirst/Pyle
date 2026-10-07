import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import {
  DynamicBondingCurveClient,
  TokenType,
  TokenDecimal,
  TokenAuthorityOption,
  BaseFeeMode,
  CollectFeeMode,
  MigrationOption,
  MigrationFeeOption,
  ActivationType,
  buildCurve,
  deriveDbcPoolAddress,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  AccountsType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

// Answers progress.md §10.2/§10.4's open question: once the DBC curve
// completes (hook revoked atomically, per §10), but BEFORE anyone actually
// calls migrateToDammV2, can a trade still happen in that gap? Throwaway
// pool, tiny threshold, never touches the live demo pool or demo-dbc-pool.json.

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z");
const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey("HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq");
const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);
const POLICY_MARKER_PUBKEY = new PublicKey(POLICY_US_ACCREDITED);
const TINY_THRESHOLD_SOL = 0.1;

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
function loadIdl(name: string) {
  const idlPath = path.resolve(import.meta.dirname, "../../target/idl", `${name}.json`);
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}
function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}
async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
  skipPreflight = false,
): Promise<string> {
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight });

  // confirmTransaction's return/throw shape has proven unreliable against
  // devnet's public RPC (same "throws a plain object, not an Error" issue
  // found in backend/src/dbcBuy.ts) -- sig is already known the moment
  // sendRawTransaction returns, so poll getTransaction directly for the
  // authoritative on-chain result instead of trusting confirmTransaction.
  let landed: Awaited<ReturnType<Connection["getTransaction"]>> = null;
  for (let i = 0; i < 30 && !landed; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    landed = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
  }
  if (!landed) {
    throw Object.assign(new Error(`${label}: transaction never confirmed within 30s (sig: ${sig})`), { signature: sig });
  }
  if (landed.meta?.err) {
    throw Object.assign(new Error(`${label} failed on-chain: ${JSON.stringify(landed.meta.err)} (sig: ${sig})`), {
      signature: sig,
      logs: landed.meta.logMessages,
    });
  }
  console.log(`[ok] ${label}: ${sig}`);
  return sig;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const walletA = loadKeypair(path.resolve(import.meta.dirname, "wallet-a-keypair.json")); // has a valid credential
  const walletB = loadKeypair(path.resolve(import.meta.dirname, "wallet-b-keypair.json")); // has NO credential

  // Wallet B just needs enough for one swap attempt + rent headroom.
  const bBalance = await connection.getBalance(walletB.publicKey);
  const B_TARGET = 0.08 * LAMPORTS_PER_SOL;
  if (bBalance < B_TARGET) {
    await sendTx(
      connection,
      new Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: walletB.publicKey, lamports: B_TARGET - bBalance })),
      [payer],
      "top up wallet B",
    );
  }

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const configKeypair = Keypair.generate();
  const baseMintKeypair = Keypair.generate();
  console.log("throwaway config:", configKeypair.publicKey.toBase58());
  console.log("throwaway base mint:", baseMintKeypair.publicKey.toBase58());

  const curveConfig = buildCurve({
    token: {
      tokenType: TokenType.Token2022,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 3600 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 25,
    migrationQuoteThreshold: TINY_THRESHOLD_SOL,
  });

  const createConfigTx = await dbcClient.partner.createConfigWithTransferHook({
    payer: payer.publicKey,
    config: configKeypair.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    quoteMint: NATIVE_MINT,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
    ...curveConfig,
  });
  await sendTx(connection, createConfigTx, [payer, configKeypair], "createConfigWithTransferHook");

  const createPoolTx = await dbcClient.creator.createPoolWithTransferHook({
    baseMint: baseMintKeypair.publicKey,
    config: configKeypair.publicKey,
    name: "Migration Gap Test",
    symbol: "GAPT",
    uri: "https://example.com/gap-test.json",
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
  });
  await sendTx(connection, createPoolTx, [payer, baseMintKeypair], "createPoolWithTransferHook");

  const dbcPoolAddress = deriveDbcPoolAddress(NATIVE_MINT, baseMintKeypair.publicKey, configKeypair.publicKey);
  console.log("throwaway pool:", dbcPoolAddress.toBase58());

  const [extraAccountMetasListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), baseMintKeypair.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  const hookIdl = loadIdl("transfer_hook");
  const hookProgram = new anchor.Program(hookIdl as anchor.Idl, provider);
  await hookProgram.methods
    .initializeExtraAccountMetasList()
    .accounts({ payer: payer.publicKey, tokenMint: baseMintKeypair.publicKey, extraAccountMetasList: extraAccountMetasListPda, systemProgram: anchor.web3.SystemProgram.programId })
    .rpc();
  console.log("[ok] initialize_extra_account_metas_list");

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

  async function attemptBuy(
    label: string,
    buyer: Keypair,
    amountSol: number,
    skipPreflight = false,
  ): Promise<{ ok: boolean; sig?: string; error?: string }> {
    patchResolverFor(buyer.publicKey);
    try {
      const tx = await dbcClient.pool.swap2WithTransferHook({
        owner: buyer.publicKey,
        pool: dbcPoolAddress,
        swapBaseForQuote: false,
        referralTokenAccount: null,
        payer: buyer.publicKey,
        swapMode: 1,
        amountIn: new BN(Math.round(amountSol * LAMPORTS_PER_SOL)),
        minimumAmountOut: new BN(0),
      } as never);
      const sig = await sendTx(connection, tx, [buyer], label, skipPreflight);
      return { ok: true, sig };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[fail] ${label}: ${msg.split("\n")[0]}`);
      const errLogs = (err as { logs?: string[] }).logs ?? [];
      for (const line of errLogs) console.log(`  log: ${line}`);
      return { ok: false, error: msg };
    }
  }

  console.log(`\n=== Step 1: push the curve to completion (threshold ${TINY_THRESHOLD_SOL} SOL) with wallet A ===`);
  for (let i = 0; i < 10; i++) {
    const poolStateNow = await dbcClient.state.getPool(dbcPoolAddress);
    const quoteReserve = new BN(poolStateNow!.poolState.quoteReserve.toString());
    const thresholdLamports = new BN(Math.round(TINY_THRESHOLD_SOL * LAMPORTS_PER_SOL));
    console.log(`  curve progress: ${quoteReserve.toString()} / ${thresholdLamports.toString()} lamports`);
    if (quoteReserve.gte(thresholdLamports)) {
      console.log("[ok] curve complete");
      break;
    }
    await attemptBuy(`buy chunk ${i + 1}`, walletA, 0.08);
  }

  console.log("\n=== Step 2: WITHOUT calling migrateToDammV2, attempt a buy as wallet B (NO credential) ===");
  const gapResultB = await attemptBuy("gap-window buy, wallet B (no credential)", walletB, 0.01, true);
  console.log("RESULT (wallet B, no credential):", gapResultB.ok ? "SUCCEEDED" : "FAILED", gapResultB.ok ? gapResultB.sig : gapResultB.error?.split("\n")[0]);

  console.log("\n=== Step 3: still without migrating, attempt a buy as wallet A (HAS a valid credential) ===");
  const gapResultA = await attemptBuy("gap-window buy, wallet A (valid credential)", walletA, 0.01, true);
  console.log("RESULT (wallet A, valid credential):", gapResultA.ok ? "SUCCEEDED" : "FAILED", gapResultA.ok ? gapResultA.sig : gapResultA.error?.split("\n")[0]);

  console.log("\n=== Verdict ===");
  if (gapResultB.ok) {
    console.log("Hook is fully gone in the gap: an uncredentialed wallet traded successfully before migration ran.");
  } else if (gapResultA.ok && !gapResultB.ok) {
    console.log("Hook is STILL enforced in the gap: credentialed wallet traded, uncredentialed wallet was blocked.");
  } else if (!gapResultA.ok && !gapResultB.ok) {
    console.log("Trading itself appears blocked in the gap (both attempts failed) -- check the error text above to see whether it's hook-related or a DBC pool-state guard.");
  }

  console.log("\n=== Cleanup: migrate to DAMM v2 so this throwaway pool doesn't sit half-finished ===");
  const poolConfigState = await dbcClient.state.getPoolConfig(configKeypair.publicKey);
  if (!poolConfigState) throw new Error("pool config not found");
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfigState.migrationFeeOption];
  const dammV2PoolAddress = deriveDammV2PoolAddress(dammConfig, baseMintKeypair.publicKey, NATIVE_MINT);
  const migrateResult = await dbcClient.migration.migrateToDammV2({ payer: payer.publicKey, pool: dbcPoolAddress, dammConfig } as never);
  const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = migrateResult as unknown as {
    transaction: Transaction;
    firstPositionNftKeypair: Keypair;
    secondPositionNftKeypair: Keypair;
  };
  await sendTx(connection, transaction, [payer, firstPositionNftKeypair, secondPositionNftKeypair], "migrateToDammV2 (cleanup)");
  console.log("damm v2 pool:", dammV2PoolAddress.toBase58());
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
