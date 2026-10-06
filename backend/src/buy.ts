import { Connection, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DEMO_MINT, DEMO_MINT_DECIMALS, DEMO_TREASURY_ATA } from "./demoMint.js";
import { DEMO_WALLETS, TREASURY_KEYPAIR, WalletKey } from "./demoWallets.js";

export interface BuyResult {
  ok: boolean;
  signature?: string;
  error?: string;
  logs?: string[];
}

/**
 * A real devnet transfer of the demo ACME token from the treasury to a buyer
 * -- no DBC pool involved (see setup-demo-mint.ts), but the exact same
 * Token-2022 transfer-hook CPI a DBC swap would trigger, so the credential
 * check transferHookWatcher.ts picks up is 100% real. transferHookWatcher
 * already listens on every transfer-hook invocation program-wide, so it
 * detects and broadcasts this transfer the same way it would a DBC buy --
 * no changes needed there.
 */
export async function buyAsWallet(
  connection: Connection,
  walletKey: WalletKey,
  amountTokens: number,
): Promise<BuyResult> {
  const buyer = DEMO_WALLETS[walletKey];
  const destinationAta = getAssociatedTokenAddressSync(
    DEMO_MINT,
    buyer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const rawAmount = BigInt(Math.round(amountTokens * 10 ** DEMO_MINT_DECIMALS));

  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    DEMO_TREASURY_ATA,
    DEMO_MINT,
    destinationAta,
    TREASURY_KEYPAIR.publicKey,
    rawAmount,
    DEMO_MINT_DECIMALS,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      TREASURY_KEYPAIR.publicKey,
      destinationAta,
      buyer.publicKey,
      DEMO_MINT,
      TOKEN_2022_PROGRAM_ID,
    ),
    transferIx,
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = TREASURY_KEYPAIR.publicKey;
  tx.sign(TREASURY_KEYPAIR);

  // skipPreflight: true deliberately -- a credential-less buy SHOULD land
  // on-chain and fail there for real (so transferHookWatcher's log
  // subscription sees and broadcasts it as a real blocked_transfer event),
  // rather than being rejected client-side by preflight simulation before
  // ever reaching the cluster, which would leave the gate feed silent about
  // a real rejection.
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) {
    return { ok: false, signature, error: JSON.stringify(confirmation.value.err) };
  }
  return { ok: true, signature };
}
