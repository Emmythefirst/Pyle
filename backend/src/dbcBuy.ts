import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { AccountsType, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ELIGIBILITY_CREDENTIAL_PROGRAM_ID, POLICY_US_ACCREDITED, TRANSFER_HOOK_PROGRAM_ID } from "./config.js";
import { DBC_EXTRA_ACCOUNT_METAS_LIST, DBC_POOL } from "./dbcPool.js";
import { DEMO_WALLETS, TREASURY_KEYPAIR, WalletKey } from "./demoWallets.js";
import { errorMessage } from "./errorMessage.js";

const POLICY_MARKER_PUBKEY = new PublicKey(POLICY_US_ACCREDITED);

function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}

/**
 * DBC's own SDK resolver (getRemainingAccountsForTransferHook) only
 * receives the mint, not the buyer, so it can't resolve our
 * recipient-dependent credential PDA -- patched per-buyer here, same
 * technique scripts/eligibility-test and scripts/graduation-test already
 * proved out (progress.md §9.2).
 */
function patchResolverFor(dbcClient: DynamicBondingCurveClient, buyer: PublicKey): void {
  (dbcClient.pool as never as Record<string, unknown>)["getRemainingAccountsForTransferHook"] = async () => {
    const accounts = [
      { pubkey: ELIGIBILITY_CREDENTIAL_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: POLICY_MARKER_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: credentialPda(buyer), isSigner: false, isWritable: false },
      { pubkey: TRANSFER_HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DBC_EXTRA_ACCOUNT_METAS_LIST, isSigner: false, isWritable: false },
    ];
    return { info: { slices: [{ accountsType: AccountsType.TransferHookBase, length: accounts.length }] }, accounts };
  };
}

export interface DbcBuyResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

// A swap needs amountIn PLUS rent for any token accounts it creates along
// the way (wrapped-SOL + base-token ATAs) -- without headroom, wallets B/C
// (which only hold enough SOL for a handful of tx fees, not real buys) fail
// on "insufficient lamports" before the hook ever runs, misrepresenting the
// demo as a funds problem instead of the credential rejection it's meant to
// show. Confirmed directly: a bare 0.05 SOL buy attempt from wallet B at
// ~0.03 SOL balance failed with raw system-program error 0x1, not the
// expected AccountNotInitialized from the hook.
const ACCOUNT_RENT_HEADROOM_SOL = 0.03;

async function ensureFunded(connection: Connection, wallet: PublicKey, minSol: number): Promise<void> {
  const minLamports = Math.round(minSol * 1e9);
  const balance = await connection.getBalance(wallet);
  if (balance >= minLamports) return;
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: TREASURY_KEYPAIR.publicKey, toPubkey: wallet, lamports: minLamports - balance }),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = TREASURY_KEYPAIR.publicKey;
  tx.sign(TREASURY_KEYPAIR);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}

/** A real DBC swap, buyer pays and signs for themselves. */
export async function buyOnDbc(
  connection: Connection,
  walletKey: WalletKey,
  amountSol: number,
): Promise<DbcBuyResult> {
  const buyer = DEMO_WALLETS[walletKey];
  await ensureFunded(connection, buyer.publicKey, amountSol + ACCOUNT_RENT_HEADROOM_SOL);

  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");
  patchResolverFor(dbcClient, buyer.publicKey);

  const tx = await dbcClient.pool.swap2WithTransferHook({
    owner: buyer.publicKey,
    pool: DBC_POOL,
    swapBaseForQuote: false,
    referralTokenAccount: null,
    payer: buyer.publicKey,
    swapMode: 1, // SwapMode.PartialFill
    amountIn: new BN(Math.round(amountSol * 1e9)),
    minimumAmountOut: new BN(0),
  } as never);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = buyer.publicKey;
  tx.sign(buyer);

  let signature: string;
  try {
    // skipPreflight: true -- a blocked buy should land on-chain and fail
    // there for real, so transferHookWatcher's log subscription actually
    // sees and broadcasts it, not get silently rejected client-side first.
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  try {
    const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (confirmation.value.err) {
      return { ok: false, signature, error: JSON.stringify(confirmation.value.err) };
    }
    return { ok: true, signature };
  } catch (err) {
    // The tx was already submitted (we have a signature) -- a thrown error
    // here means confirmation itself hit trouble (e.g. devnet RPC rate
    // limiting), not that the swap failed. Caller can still look the
    // signature up directly if needed.
    return { ok: false, signature, error: errorMessage(err) };
  }
}
