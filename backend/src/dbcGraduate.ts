import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  AccountsType,
  DynamicBondingCurveClient,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ELIGIBILITY_CREDENTIAL_PROGRAM_ID, POLICY_US_ACCREDITED, TRANSFER_HOOK_PROGRAM_ID } from "./config.js";
import { DBC_BASE_MINT, DBC_CONFIG, DBC_EXTRA_ACCOUNT_METAS_LIST, DBC_MIGRATION_QUOTE_THRESHOLD, DBC_POOL } from "./dbcPool.js";
import { DEMO_WALLETS, TREASURY_KEYPAIR } from "./demoWallets.js";

const POLICY_MARKER_PUBKEY = new PublicKey(POLICY_US_ACCREDITED);

function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}

async function sendTx(connection: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

export interface GraduationResult {
  alreadyGraduated: boolean;
  buySignatures: string[];
  completeSignature: string | null;
  migrateSignature: string | null;
  dammV2Pool: string;
}

/**
 * Pushes the real DBC curve to completion (via wallet A, which already
 * holds a valid credential) and migrates to DAMM v2 for real -- the exact
 * mechanics scripts/graduation-test proved out (progress.md §10): the
 * transfer hook is revoked by DBC itself, atomically, inside the very buy
 * that completes the curve, not as a separate step we perform.
 */
export async function runGraduation(connection: Connection): Promise<GraduationResult> {
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");
  const buyer = DEMO_WALLETS.A;

  (dbcClient.pool as never as Record<string, unknown>)["getRemainingAccountsForTransferHook"] = async () => {
    const accounts = [
      { pubkey: ELIGIBILITY_CREDENTIAL_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: POLICY_MARKER_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: credentialPda(buyer.publicKey), isSigner: false, isWritable: false },
      { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DBC_EXTRA_ACCOUNT_METAS_LIST, isSigner: false, isWritable: false },
    ];
    return { info: { slices: [{ accountsType: AccountsType.TransferHookBase, length: accounts.length }] }, accounts };
  };

  const thresholdLamports = new BN(Math.round(DBC_MIGRATION_QUOTE_THRESHOLD * 1e9));
  const CHUNK_IN = new BN(Math.round(0.6 * 1e9));

  const buySignatures: string[] = [];
  let completeSignature: string | null = null;

  for (let i = 0; i < 10; i++) {
    const poolStateNow = await dbcClient.state.getPool(DBC_POOL);
    const quoteReserve = new BN(poolStateNow!.poolState.quoteReserve.toString());
    if (quoteReserve.gte(thresholdLamports)) {
      if (buySignatures.length > 0) completeSignature = buySignatures[buySignatures.length - 1];
      break;
    }
    const buyTx = await dbcClient.pool.swap2WithTransferHook({
      owner: buyer.publicKey,
      pool: DBC_POOL,
      swapBaseForQuote: false,
      referralTokenAccount: null,
      payer: buyer.publicKey,
      swapMode: 1, // SwapMode.PartialFill -- safely over-fills the last chunk without erroring
      amountIn: CHUNK_IN,
      minimumAmountOut: new BN(0),
    } as never);
    const sig = await sendTx(connection, buyTx, [buyer]);
    buySignatures.push(sig);
    completeSignature = sig;
  }

  const poolConfigState = await dbcClient.state.getPoolConfig(DBC_CONFIG);
  if (!poolConfigState) throw new Error("DBC pool config not found on-chain");
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfigState.migrationFeeOption];
  const dammV2PoolAddress = deriveDammV2PoolAddress(dammConfig, DBC_BASE_MINT, NATIVE_MINT);

  const alreadyMigrated = await connection.getAccountInfo(dammV2PoolAddress);
  if (alreadyMigrated) {
    return {
      alreadyGraduated: true,
      buySignatures,
      completeSignature,
      migrateSignature: null,
      dammV2Pool: dammV2PoolAddress.toBase58(),
    };
  }

  const migrateResult = await dbcClient.migration.migrateToDammV2({
    payer: TREASURY_KEYPAIR.publicKey,
    pool: DBC_POOL,
    dammConfig,
  } as never);
  const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = migrateResult as unknown as {
    transaction: Transaction;
    firstPositionNftKeypair: Keypair;
    secondPositionNftKeypair: Keypair;
  };
  const migrateSignature = await sendTx(connection, transaction, [TREASURY_KEYPAIR, firstPositionNftKeypair, secondPositionNftKeypair]);

  return {
    alreadyGraduated: false,
    buySignatures,
    completeSignature,
    migrateSignature,
    dammV2Pool: dammV2PoolAddress.toBase58(),
  };
}
