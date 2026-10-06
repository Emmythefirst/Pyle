import { Connection } from "@solana/web3.js";
import { TRANSFER_HOOK_PROGRAM_ID } from "../config.js";
import { parseTransferHookInvocation } from "../txParser.js";
import { recordBlockedTransfer, recordSuccessfulBuy } from "../state.js";

/**
 * Classifies *why* a transfer was blocked from the transaction's own log
 * lines -- these are the exact AnchorError messages transfer-hook's error.rs
 * and Anchor's own AccountNotInitialized check produce (verified against
 * real devnet transactions in progress.md §11.5), not guessed strings.
 */
function classifyBlockReason(logs: string[]): string {
  const text = logs.join("\n");
  if (text.includes("Error Code: CredentialExpired")) return "Credential expired";
  if (text.includes("Error Code: CredentialRevoked")) return "Credential revoked";
  if (text.includes("AccountNotInitialized") && text.includes("account: credential")) {
    return "No credential on file";
  }
  if (text.includes("Error Code: IsNotCurrentlyTransferring")) {
    return "Invalid transfer context";
  }
  return "Transfer blocked (unspecified reason)";
}

export function watchTransferHook(connection: Connection): void {
  connection.onLogs(
    TRANSFER_HOOK_PROGRAM_ID,
    (logs) => {
      // Fire-and-forget: each notification needs its own extra RPC round
      // trip (getTransaction + one account fetch) to resolve wallet/amount,
      // and we don't want to block the log-subscription callback on it.
      void handleLogs(connection, logs);
    },
    "confirmed",
  );
  console.log(`Watching transfer-hook (${TRANSFER_HOOK_PROGRAM_ID.toBase58()}) for buys and blocks...`);
}

async function handleLogs(
  connection: Connection,
  logs: { signature: string; err: unknown; logs: string[] },
): Promise<void> {
  // Instruction-only invocations (not real transfers) are rejected by
  // transfer_hook.rs's assert_is_transferring check before touching the
  // credential at all -- skip those; they're not a real buy or a real block.
  if (!logs.logs.some((l) => l.includes("Instruction: TransferHook"))) return;

  try {
    const { wallet, amount } = await parseTransferHookInvocation(connection, logs.signature);
    const timestamp = Date.now();

    if (logs.err) {
      recordBlockedTransfer({
        type: "blocked_transfer",
        wallet,
        reason: classifyBlockReason(logs.logs),
        amount,
        signature: logs.signature,
        timestamp,
      });
      console.log(`[blocked] ${wallet ?? "?"} -- ${classifyBlockReason(logs.logs)} (${logs.signature})`);
    } else {
      recordSuccessfulBuy({
        type: "successful_buy",
        wallet,
        amount,
        signature: logs.signature,
        timestamp,
      });
      console.log(`[buy] ${wallet ?? "?"} -- ${amount ?? "?"} base units (${logs.signature})`);
    }
  } catch (err) {
    console.error(`Failed to parse transfer-hook transaction ${logs.signature}:`, err);
  }
}
