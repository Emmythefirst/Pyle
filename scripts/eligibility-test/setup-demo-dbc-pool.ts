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
} from "@meteora-ag/dynamic-bonding-curve-sdk";

// One-time setup for a PERSISTENT DBC pool the live terminal's real Buy and
// Run graduation actions operate against -- unlike scripts/eligibility-test's
// own pool (threshold deliberately kept out of reach so tests never trigger
// a real graduation), this one uses a deliberately LOW threshold so a
// handful of real buys can complete it live, matching the original brief's
// demo script requirement #4. Mechanics (hook-revoked-at-completion, real
// migrateToDammV2) already proven in scripts/graduation-test -- see
// progress.md §10. Run once; writes demo-dbc-pool.json for the backend.

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);
const MIGRATION_QUOTE_THRESHOLD = 2; // SOL -- demo-friendly, reachable in a few real buys

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(name: string) {
  const idlPath = path.resolve(import.meta.dirname, "../../target/idl", `${name}.json`);
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
): Promise<string> {
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`[ok] ${label}: ${sig}`);
  return sig;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("payer:", payer.publicKey.toBase58());

  // Wallet A needs to cover its own demo-buy fees plus several ~1 SOL buys
  // to push the curve across MIGRATION_QUOTE_THRESHOLD on demand.
  const walletA = loadKeypair(path.resolve(import.meta.dirname, "wallet-a-keypair.json"));
  const TARGET_BALANCE = 3.5 * LAMPORTS_PER_SOL;
  const aBalance = await connection.getBalance(walletA.publicKey);
  if (aBalance < TARGET_BALANCE) {
    const fundTx = new Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: walletA.publicKey,
        lamports: TARGET_BALANCE - aBalance,
      }),
    );
    await sendTx(connection, fundTx, [payer], "top up wallet A for graduation buys");
  } else {
    console.log("[skip] wallet A already funded:", (aBalance / LAMPORTS_PER_SOL).toFixed(4), "SOL");
  }

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  const configKeypair = Keypair.generate();
  const baseMintKeypair = Keypair.generate();
  console.log("dbc config:", configKeypair.publicKey.toBase58());
  console.log("base mint:", baseMintKeypair.publicKey.toBase58());

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
        feeSchedulerParam: {
          startingFeeBps: 500,
          endingFeeBps: 100,
          numberOfPeriod: 10,
          totalDuration: 3600,
        },
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
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: 25,
    migrationQuoteThreshold: MIGRATION_QUOTE_THRESHOLD,
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
    name: "Acme Industries",
    symbol: "ACME",
    uri: "https://example.com/acme.json",
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
  });
  await sendTx(connection, createPoolTx, [payer, baseMintKeypair], "createPoolWithTransferHook");

  const dbcPoolAddress = deriveDbcPoolAddress(NATIVE_MINT, baseMintKeypair.publicKey, configKeypair.publicKey);
  console.log("dbc pool:", dbcPoolAddress.toBase58());

  const [extraAccountMetasListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), baseMintKeypair.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  const hookIdl = loadIdl("transfer_hook");
  const hookProgram = new anchor.Program(hookIdl as anchor.Idl, provider);
  await hookProgram.methods
    .initializeExtraAccountMetasList()
    .accounts({
      payer: payer.publicKey,
      tokenMint: baseMintKeypair.publicKey,
      extraAccountMetasList: extraAccountMetasListPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] initialize_extra_account_metas_list");

  const out = {
    config: configKeypair.publicKey.toBase58(),
    baseMint: baseMintKeypair.publicKey.toBase58(),
    pool: dbcPoolAddress.toBase58(),
    extraAccountMetasList: extraAccountMetasListPda.toBase58(),
    migrationQuoteThreshold: MIGRATION_QUOTE_THRESHOLD,
  };
  const outPath = path.resolve(import.meta.dirname, "../../demo-dbc-pool.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("saved", outPath, out);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
