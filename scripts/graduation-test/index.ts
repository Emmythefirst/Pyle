import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
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
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(name: string) {
  const idlPath = path.resolve(
    import.meta.dirname,
    "../../target/idl",
    `${name}.json`,
  );
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
): Promise<string> {
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log(`[ok] ${label}: ${sig}`);
  return sig;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const payer = loadKeypair(
    path.join(os.homedir(), ".config/solana/id.json"),
  );
  console.log("payer:", payer.publicKey.toBase58());

  // Reuse the same buyer wallet across runs (persisted locally) instead of
  // generating + funding a fresh throwaway keypair every attempt — the
  // network here has been flaky enough that repeated runs were stranding
  // devnet SOL on abandoned wallets and draining the payer.
  const buyerKeypairPath = path.resolve(import.meta.dirname, "buyer-keypair.json");
  let buyer: Keypair;
  if (fs.existsSync(buyerKeypairPath)) {
    buyer = loadKeypair(buyerKeypairPath);
  } else {
    buyer = Keypair.generate();
    fs.writeFileSync(buyerKeypairPath, JSON.stringify(Array.from(buyer.secretKey)));
  }
  console.log("buyer (test wallet A):", buyer.publicKey.toBase58());

  {
    const MIN_BUYER_BALANCE = 0.08 * LAMPORTS_PER_SOL;
    const buyerBalance = await connection.getBalance(buyer.publicKey);
    if (buyerBalance < MIN_BUYER_BALANCE) {
      const fundTx = new Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: buyer.publicKey,
          lamports: MIN_BUYER_BALANCE - buyerBalance,
        }),
      );
      await sendTx(connection, fundTx, [payer], "top up buyer wallet");
    } else {
      console.log("[skip] buyer already has enough SOL:", buyerBalance / LAMPORTS_PER_SOL);
    }
  }

  // ---- 1. Our transfer-hook program: make payer the admin ----
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" },
  );
  const hookIdl = loadIdl("transfer_hook");
  const hookProgram = new anchor.Program(hookIdl as anchor.Idl, provider);

  const [adminConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("admin-config")],
    TRANSFER_HOOK_PROGRAM_ID,
  );

  const adminConfigInfo = await connection.getAccountInfo(adminConfigPda);
  if (!adminConfigInfo) {
    await hookProgram.methods
      .configureAdmin()
      .accounts({
        admin: payer.publicKey,
        newAdmin: payer.publicKey,
        adminConfig: adminConfigPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("[ok] configure_admin: payer is now admin");
  } else {
    console.log("[skip] configure_admin: admin already configured (payer, from an earlier run)");
  }

  // Allow the buyer wallet up front so it can trade during the DBC phase.
  const [buyerGatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("gate"), buyer.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  await hookProgram.methods
    .setAllowed(true)
    .accounts({
      admin: payer.publicKey,
      wallet: buyer.publicKey,
      adminConfig: adminConfigPda,
      walletGate: buyerGatePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] set_allowed(buyer, true)");

  // ---- 2. DBC: create config + pool with our transfer hook attached ----
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

  // Resume mode: this network has been flaky enough (and devnet SOL scarce
  // enough) that re-running the whole config/pool/buy sequence from zero on
  // every retry got expensive. If RESUME_CONFIG + RESUME_BASE_MINT are set,
  // skip straight to the buy loop against that already-created pool.
  const resumeConfig = process.env.RESUME_CONFIG;
  const resumeBaseMint = process.env.RESUME_BASE_MINT;
  const configKeypair = resumeConfig
    ? { publicKey: new PublicKey(resumeConfig) }
    : Keypair.generate();
  const baseMintKeypair = resumeBaseMint
    ? { publicKey: new PublicKey(resumeBaseMint) }
    : Keypair.generate();
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
    // Kept small on purpose so test buys are cheap. Earlier InsufficientLiquidity
    // failures at small thresholds were actually caused by using SwapMode.ExactIn
    // right at the curve's capacity ceiling (which requires an exact, non-partial
    // fill) — fixed by switching buy chunks to SwapMode.PartialFill below, not by
    // the threshold size itself.
    migrationQuoteThreshold: 0.2,
  });

  if (!resumeConfig) {
    const createConfigTx = await dbcClient.partner.createConfigWithTransferHook({
      payer: payer.publicKey,
      config: configKeypair.publicKey,
      feeClaimer: payer.publicKey,
      leftoverReceiver: payer.publicKey,
      quoteMint: NATIVE_MINT,
      transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
      ...curveConfig,
    });
    await sendTx(
      connection,
      createConfigTx,
      [payer, configKeypair as Keypair],
      "createConfigWithTransferHook",
    );

    const createPoolTx = await dbcClient.creator.createPoolWithTransferHook({
      baseMint: baseMintKeypair.publicKey,
      config: configKeypair.publicKey,
      name: "Pyle Test",
      symbol: "PYLET",
      uri: "https://example.com/pyle-test.json",
      payer: payer.publicKey,
      poolCreator: payer.publicKey,
      transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
    });
    await sendTx(
      connection,
      createPoolTx,
      [payer, baseMintKeypair as Keypair],
      "createPoolWithTransferHook",
    );
  } else {
    console.log("[skip] createConfigWithTransferHook + createPoolWithTransferHook (resuming)");
  }

  const dbcPoolAddress = deriveDbcPoolAddress(
    NATIVE_MINT,
    baseMintKeypair.publicKey,
    configKeypair.publicKey,
  );
  console.log("dbc pool:", dbcPoolAddress.toBase58());

  // ---- 3. Now that the mint exists on-chain, register our extra-account-metas ----
  const [extraAccountMetasListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), baseMintKeypair.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  if (!resumeConfig) {
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
  } else {
    console.log("[skip] initialize_extra_account_metas_list (resuming)");
  }

  // ---- 4. Buy enough from the allowed wallet to complete the curve ----
  // A single large buy (e.g. straight to the 1 SOL threshold) hit
  // InsufficientLiquidity — bonding-curve AMM math apparently can't service
  // one swap that large in one step. Buying in smaller chunks and polling
  // quoteReserve works instead.
  const CHUNK_IN = new BN(0.1 * LAMPORTS_PER_SOL);

  // The SDK's own extra-account resolver (getRemainingAccountsForTransferHook)
  // discovers which extra accounts a mint's hook needs by calling
  // createTransferCheckedWithTransferHookInstruction with PublicKey.default
  // as a *placeholder* for source/destination/owner (it only wants to learn
  // which accounts exist, generically, per-mint). That's fine for hooks whose
  // extra accounts don't depend on who's transferring, but ours is seeded
  // from the *real* destination owner (Seed::AccountData reading the
  // destination token account) — against an all-zero placeholder that read
  // throws TokenTransferHookInvalidSeed before a transaction is even built.
  // Patch in a corrected resolver for our specific buyer so the rest of
  // swap2WithTransferHook's (otherwise correct) transaction-building logic
  // can proceed.
  const [extraAccountMetasListPdaForBuyer] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), baseMintKeypair.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  (dbcClient.pool as never as Record<string, unknown>)[
    "getRemainingAccountsForTransferHook"
  ] = async () => {
    const accounts = [
      { pubkey: buyerGatePda, isSigner: false, isWritable: false },
      { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: extraAccountMetasListPdaForBuyer, isSigner: false, isWritable: false },
    ];
    return {
      info: {
        slices: [
          { accountsType: AccountsType.TransferHookBase, length: accounts.length },
        ],
      },
      accounts,
    };
  };

  const MIGRATION_QUOTE_THRESHOLD_LAMPORTS = new BN(0.2 * LAMPORTS_PER_SOL);
  for (let i = 0; i < 10; i++) {
    const poolStateNow = await dbcClient.state.getPool(dbcPoolAddress);
    const quoteReserve = new BN(poolStateNow!.poolState.quoteReserve.toString());
    console.log(
      `  curve progress: ${quoteReserve.toString()} / ${MIGRATION_QUOTE_THRESHOLD_LAMPORTS.toString()} lamports`,
    );
    if (quoteReserve.gte(MIGRATION_QUOTE_THRESHOLD_LAMPORTS)) {
      console.log("[ok] curve complete");
      break;
    }
    // ExactIn requires the full amountIn to be exactly consumable by the
    // curve (on-chain: `require!(amount_left == 0, InsufficientLiquidity)`)
    // — any request that would cross the migration price ceiling fails
    // outright rather than partially filling. PartialFill instead fills as
    // much as the curve can currently absorb, so a flat over-generous
    // amountIn works safely on every chunk, including the last.
    const buyTx = await dbcClient.pool.swap2WithTransferHook({
      owner: buyer.publicKey,
      pool: dbcPoolAddress,
      swapBaseForQuote: false,
      referralTokenAccount: null,
      payer: buyer.publicKey,
      swapMode: 1, // SwapMode.PartialFill
      amountIn: CHUNK_IN,
      minimumAmountOut: new BN(0),
    } as never);
    await sendTx(connection, buyTx, [buyer], `swap2WithTransferHook (buy chunk ${i + 1})`);
  }

  // ---- 5. Migrate to DAMM v2 ----
  const poolConfigState = await dbcClient.state.getPoolConfig(
    configKeypair.publicKey,
  );
  const dammConfig =
    DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfigState.migrationFeeOption];

  const dammV2PoolAddress = deriveDammV2PoolAddress(
    dammConfig,
    baseMintKeypair.publicKey,
    NATIVE_MINT,
  );

  const dammV2PoolAlreadyExists = await connection.getAccountInfo(dammV2PoolAddress);
  if (!dammV2PoolAlreadyExists) {
    const migrateResult = await dbcClient.migration.migrateToDammV2({
      payer: payer.publicKey,
      pool: dbcPoolAddress,
      dammConfig,
    } as never);
    const { transaction: migrateTx, firstPositionNftKeypair, secondPositionNftKeypair } =
      migrateResult as unknown as {
        transaction: Transaction;
        firstPositionNftKeypair: Keypair;
        secondPositionNftKeypair: Keypair;
      };
    await sendTx(
      connection,
      migrateTx,
      [payer, firstPositionNftKeypair, secondPositionNftKeypair],
      "migrateToDammV2",
    );
  } else {
    console.log("[skip] migrateToDammV2 (already migrated)");
  }
  console.log("damm v2 pool:", dammV2PoolAddress.toBase58());

  // ---- 6. THE TEST: attempt a swap in the graduated DAMM v2 pool ----
  const cpAmm = new CpAmm(connection);
  const poolState = await cpAmm.fetchPoolState(dammV2PoolAddress);

  const isBaseTokenA = poolState.tokenAMint.equals(baseMintKeypair.publicKey);
  const tokenAProgram = isBaseTokenA ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const tokenBProgram = isBaseTokenA ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  console.log("\n=== Attempting DAMM v2 swap (buyer is ALLOWED) ===");
  try {
    const tx = await cpAmm.swap({
      payer: buyer.publicKey,
      pool: dammV2PoolAddress,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMintKeypair.publicKey,
      amountIn: new BN(0.001 * LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram,
      tokenBProgram,
      referralTokenAccount: null,
    });
    await sendTx(connection, tx, [buyer], "DAMM v2 swap (allowed buyer)");
    console.log("RESULT: swap SUCCEEDED while buyer was allowed.");
  } catch (err) {
    console.log("RESULT: swap FAILED while buyer was allowed (unexpected).");
    console.error(err);
  }

  console.log(
    "\n=== Flipping buyer to NOT allowed, then attempting another swap ===",
  );
  await hookProgram.methods
    .setAllowed(false)
    .accounts({
      admin: payer.publicKey,
      wallet: buyer.publicKey,
      adminConfig: adminConfigPda,
      walletGate: buyerGatePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] set_allowed(buyer, false)");

  try {
    const tx2 = await cpAmm.swap({
      payer: buyer.publicKey,
      pool: dammV2PoolAddress,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMintKeypair.publicKey,
      amountIn: new BN(0.001 * LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram,
      tokenBProgram,
      referralTokenAccount: null,
    });
    await sendTx(connection, tx2, [buyer], "DAMM v2 swap (disallowed buyer)");
    console.log(
      "RESULT: swap SUCCEEDED even though buyer is disallowed — hook did NOT enforce.",
    );
  } catch (err) {
    console.log(
      "RESULT: swap FAILED as expected while buyer is disallowed — hook DID enforce.",
    );
    console.error(err);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
