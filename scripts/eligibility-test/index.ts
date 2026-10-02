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
  AccountsType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

// This is the real demo-script test (progress.md §1's Wallet A/B/C flow),
// replacing the WalletGate placeholder proven out by scripts/graduation-test.
// It only exercises the DBC phase -- progress.md §10 already proved
// (empirically, three times over, confirmed by Meteora) that no transfer
// hook survives past curve completion, so there is nothing new to learn by
// migrating to DAMM v2 here. Buys stay far below migrationQuoteThreshold on
// purpose so the curve never completes mid-test and strips the hook out
// from under us.

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);
const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey(
  "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
);

// Must byte-for-byte match eligibility-credential's POLICY_US_ACCREDITED
// const: b"US_ACCREDITED" zero-padded to 32 bytes.
const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);
// Same 32 bytes, reinterpreted as a Pubkey -- this is the `policy_marker`
// extra account's address (see initialise_extra_account_metas_list.rs for
// why: a 32-byte policy_id can't fit as a literal seed in the 32-byte TLV
// seed-config budget, so the hook instead reads it off an extra account's
// own address via `Seed::AccountKey`).
const POLICY_MARKER_PUBKEY = new PublicKey(POLICY_US_ACCREDITED);

function loadOrCreateKeypair(filePath: string): Keypair {
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

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

  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("payer (issuer):", payer.publicKey.toBase58());

  // Wallet A: will hold a valid, unexpired credential -- expect buys to succeed.
  // Wallet B: never issued a credential -- expect buys to fail (AccountNotInitialized).
  // Wallet C: holds a credential that is already expired -- expect buys to fail
  //           distinctly (CredentialExpired), proving the expiry check does real work.
  const walletA = loadOrCreateKeypair(
    path.resolve(import.meta.dirname, "wallet-a-keypair.json"),
  );
  const walletB = loadOrCreateKeypair(
    path.resolve(import.meta.dirname, "wallet-b-keypair.json"),
  );
  const walletC = loadOrCreateKeypair(
    path.resolve(import.meta.dirname, "wallet-c-keypair.json"),
  );
  console.log("wallet A (valid credential):", walletA.publicKey.toBase58());
  console.log("wallet B (no credential):", walletB.publicKey.toBase58());
  console.log("wallet C (expired credential):", walletC.publicKey.toBase58());

  const MIN_BALANCE = 0.03 * LAMPORTS_PER_SOL;
  for (const w of [walletA, walletB, walletC]) {
    const balance = await connection.getBalance(w.publicKey);
    if (balance < MIN_BALANCE) {
      const fundTx = new Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: w.publicKey,
          lamports: MIN_BALANCE - balance,
        }),
      );
      await sendTx(connection, fundTx, [payer], `top up ${w.publicKey.toBase58()}`);
    } else {
      console.log(`[skip] ${w.publicKey.toBase58()} already funded`);
    }
  }

  // ---- 1. eligibility-credential: configure issuer, issue A + C's credentials ----
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const credentialIdl = loadIdl("eligibility_credential");
  const credentialProgram = new anchor.Program(credentialIdl as anchor.Idl, provider);

  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  );
  const issuerConfigInfo = await connection.getAccountInfo(issuerConfigPda);
  if (!issuerConfigInfo) {
    await credentialProgram.methods
      .configureIssuer()
      .accounts({
        issuer: payer.publicKey,
        newIssuer: payer.publicKey,
        issuerConfig: issuerConfigPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("[ok] configure_issuer: payer is now issuer");
  } else {
    console.log("[skip] configure_issuer (already configured, from an earlier run)");
  }

  const ONE_YEAR_SECS = 365 * 24 * 60 * 60;
  const nowSecs = Math.floor(Date.now() / 1000);

  await credentialProgram.methods
    .issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(nowSecs + ONE_YEAR_SECS))
    .accounts({
      issuer: payer.publicKey,
      wallet: walletA.publicKey,
      issuerConfig: issuerConfigPda,
      credential: credentialPda(walletA.publicKey),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] issue_credential(A, valid, expires in 1 year)");

  // Wallet B: deliberately skipped -- no credential account will exist for it.

  await credentialProgram.methods
    .issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(nowSecs - 3600))
    .accounts({
      issuer: payer.publicKey,
      wallet: walletC.publicKey,
      issuerConfig: issuerConfigPda,
      credential: credentialPda(walletC.publicKey),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] issue_credential(C, already expired)");

  // ---- 2. DBC: create a pool with our transfer hook attached ----
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");

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
    // Kept deliberately far above anything three ~0.01 SOL test buys could
    // reach -- the curve must NOT complete during this test, or DBC strips
    // the transfer hook (progress.md §10) and the eligibility checks below
    // stop meaning anything.
    migrationQuoteThreshold: 10,
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
      name: "Pyle Eligibility Test",
      symbol: "PYLEE",
      uri: "https://example.com/pyle-eligibility-test.json",
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

  const [extraAccountMetasListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), baseMintKeypair.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  if (!resumeConfig) {
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
  } else {
    console.log("[skip] initialize_extra_account_metas_list (resuming)");
  }

  // ---- 3. The actual test: one small buy per wallet ----
  // DBC's own extra-account resolver can't handle our recipient-dependent
  // seeds (see progress.md §9.2) -- patched per-buyer below, closing over
  // whichever wallet is buying right now, since getRemainingAccountsForTransferHook
  // only receives the mint, not the buyer.
  function patchResolverFor(buyer: PublicKey) {
    (dbcClient.pool as never as Record<string, unknown>)[
      "getRemainingAccountsForTransferHook"
    ] = async () => {
      const accounts = [
        { pubkey: ELIGIBILITY_CREDENTIAL_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: POLICY_MARKER_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: credentialPda(buyer), isSigner: false, isWritable: false },
        { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: extraAccountMetasListPda, isSigner: false, isWritable: false },
      ];
      return {
        info: {
          slices: [{ accountsType: AccountsType.TransferHookBase, length: accounts.length }],
        },
        accounts,
      };
    };
  }

  const BUY_AMOUNT = new BN(0.01 * LAMPORTS_PER_SOL);

  async function attemptBuy(label: string, buyer: Keypair): Promise<boolean> {
    patchResolverFor(buyer.publicKey);
    try {
      const buyTx = await dbcClient.pool.swap2WithTransferHook({
        owner: buyer.publicKey,
        pool: dbcPoolAddress,
        swapBaseForQuote: false,
        referralTokenAccount: null,
        payer: buyer.publicKey,
        swapMode: 1, // SwapMode.PartialFill
        amountIn: BUY_AMOUNT,
        minimumAmountOut: new BN(0),
      } as never);
      await sendTx(connection, buyTx, [buyer], `buy (${label})`);
      console.log(`RESULT ${label}: buy SUCCEEDED.`);
      return true;
    } catch (err) {
      console.log(`RESULT ${label}: buy FAILED.`);
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  reason: ${message.split("\n")[0]}`);
      const logs = (err as { logs?: string[]; transactionLogs?: string[] });
      for (const line of logs.transactionLogs ?? logs.logs ?? []) {
        console.log(`  log: ${line}`);
      }
      return false;
    }
  }

  console.log("\n=== Wallet A: valid credential -- expect SUCCESS ===");
  await attemptBuy("wallet A / valid", walletA);

  console.log("\n=== Wallet B: no credential -- expect FAILURE (AccountNotInitialized) ===");
  await attemptBuy("wallet B / no credential", walletB);

  console.log("\n=== Wallet C: expired credential -- expect FAILURE (CredentialExpired) ===");
  await attemptBuy("wallet C / expired", walletC);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
