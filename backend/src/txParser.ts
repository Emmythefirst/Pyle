import { Connection, VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { TRANSFER_HOOK_PROGRAM_ID } from "./config.js";

export interface ParsedTransferHookInvocation {
  wallet: string | null; // the buyer -- always the transaction's fee payer in Pyle's own flows
  amount: string | null; // raw token amount, base units
}

// ExecuteInstruction's data is [8-byte SPL discriminator][amount: u64 LE] --
// no Anchor sighash involved, since spl-transfer-hook-interface uses its own
// SplDiscriminate-based discriminator (see transfer-hook's lib.rs).
const EXECUTE_DISCRIMINATOR_LEN = 8;

// A transaction's account index 0 is always its fee payer by convention --
// and in every one of Pyle's own flows (direct transfer, DBC buy), the
// buyer signs and pays for their own purchase, so this is always them.
// Deliberately NOT read from the Execute instruction's destination token
// account: for a BLOCKED buy the whole transaction reverts atomically, so
// any account that instruction tentatively created (the buyer's first-ever
// ATA on this mint, commonly) never actually commits -- confirmed directly,
// a real blocked-buy signature's destination ATA read back as
// non-existent moments later, even though its own CreateIdempotent inner
// instruction logged "success" earlier in the same (ultimately reverted)
// transaction.
const FEE_PAYER_INDEX = 0;

/**
 * Finds the transfer-hook program's Execute invocation inside a transaction
 * (always a CPI -- Token-2022 invokes it during transfer_checked, itself
 * usually invoked by a DBC swap) and extracts the buyer wallet + amount.
 * Returns null fields (not a thrown error) if the hook wasn't invoked, so
 * callers can fail soft on unrelated transactions.
 */
export async function parseTransferHookInvocation(
  connection: Connection,
  signature: string,
): Promise<ParsedTransferHookInvocation> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) return { wallet: null, amount: null };
  return parseFromTransaction(tx);
}

function parseFromTransaction(tx: VersionedTransactionResponse): ParsedTransferHookInvocation {
  const accountKeys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });

  const innerGroups = tx.meta?.innerInstructions ?? [];
  for (const group of innerGroups) {
    for (const ix of group.instructions) {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId || !programId.equals(TRANSFER_HOOK_PROGRAM_ID)) continue;

      const data = Buffer.from(bs58.decode(ix.data));
      const amount =
        data.length >= EXECUTE_DISCRIMINATOR_LEN + 8
          ? data.readBigUInt64LE(EXECUTE_DISCRIMINATOR_LEN).toString()
          : null;
      const wallet = accountKeys.get(FEE_PAYER_INDEX)?.toBase58() ?? null;

      return { wallet, amount };
    }
  }
  return { wallet: null, amount: null };
}
