import { Connection, PublicKey, VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { TRANSFER_HOOK_PROGRAM_ID } from "./config.js";

export interface ParsedTransferHookInvocation {
  wallet: string | null; // destination token account's owner
  amount: string | null; // raw token amount, base units
}

// Token-2022's Execute account order is fixed:
// [source, mint, destination, owner, validation, ...extra] (see
// programs/transfer-hook/src/instructions/transfer_hook.rs) -- destination
// is always index 2. Its owner field sits at byte offset 32 in the base
// SPL Token account layout, the same technique used throughout the Rust
// program and the test scripts.
const DESTINATION_ACCOUNT_INDEX = 2;
const TOKEN_ACCOUNT_OWNER_OFFSET = 32;

// ExecuteInstruction's data is [8-byte SPL discriminator][amount: u64 LE] --
// no Anchor sighash involved, since spl-transfer-hook-interface uses its own
// SplDiscriminate-based discriminator (see transfer-hook's lib.rs).
const EXECUTE_DISCRIMINATOR_LEN = 8;

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
  return parseFromTransaction(connection, tx);
}

async function parseFromTransaction(
  connection: Connection,
  tx: VersionedTransactionResponse,
): Promise<ParsedTransferHookInvocation> {
  const accountKeys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });

  const innerGroups = tx.meta?.innerInstructions ?? [];
  for (const group of innerGroups) {
    for (const ix of group.instructions) {
      const programId = accountKeys.get(ix.programIdIndex);
      if (!programId || !programId.equals(TRANSFER_HOOK_PROGRAM_ID)) continue;
      if (ix.accounts.length <= DESTINATION_ACCOUNT_INDEX) continue;

      const destinationAccount = accountKeys.get(ix.accounts[DESTINATION_ACCOUNT_INDEX]);
      const data = Buffer.from(bs58.decode(ix.data));
      const amount =
        data.length >= EXECUTE_DISCRIMINATOR_LEN + 8
          ? data.readBigUInt64LE(EXECUTE_DISCRIMINATOR_LEN).toString()
          : null;

      const wallet = destinationAccount
        ? await resolveTokenAccountOwner(connection, destinationAccount)
        : null;

      return { wallet, amount };
    }
  }
  return { wallet: null, amount: null };
}

async function resolveTokenAccountOwner(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<string | null> {
  const info = await connection.getAccountInfo(tokenAccount);
  if (!info || info.data.length < TOKEN_ACCOUNT_OWNER_OFFSET + 32) return null;
  return new PublicKey(
    info.data.subarray(TOKEN_ACCOUNT_OWNER_OFFSET, TOKEN_ACCOUNT_OWNER_OFFSET + 32),
  ).toBase58();
}
