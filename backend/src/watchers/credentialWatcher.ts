import { Connection, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ELIGIBILITY_CREDENTIAL_PROGRAM_ID, CREDENTIAL_POLL_INTERVAL_MS } from "../config.js";
import { recordCredentialActivity, updateCredentialedWalletCount } from "../state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// issue_credential/revoke_credential are called directly (top-level) by
// scripts/issuer-bridge, not via CPI, so the wallet is in the transaction's
// own top-level instruction accounts -- index 1 per the IDL's account order
// [issuer, wallet, issuer_config, credential, system_program].
const WALLET_ACCOUNT_INDEX = 1;

export function watchCredentialActivity(connection: Connection): void {
  connection.onLogs(
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
    (logs) => {
      void handleLogs(connection, logs);
    },
    "confirmed",
  );
  console.log(
    `Watching eligibility-credential (${ELIGIBILITY_CREDENTIAL_PROGRAM_ID.toBase58()}) for issue/revoke activity...`,
  );
}

async function handleLogs(
  connection: Connection,
  logs: { signature: string; err: unknown; logs: string[] },
): Promise<void> {
  if (logs.err) return; // only real, successful issuance/revocation is activity worth showing
  const isIssue = logs.logs.some((l) => l.includes("Instruction: IssueCredential"));
  const isRevoke = logs.logs.some((l) => l.includes("Instruction: RevokeCredential"));
  if (!isIssue && !isRevoke) return;

  try {
    const tx = await connection.getTransaction(logs.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return;

    const accountKeys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta?.loadedAddresses,
    });
    const topLevelIx = tx.transaction.message.compiledInstructions.find((ix) => {
      const programId = accountKeys.get(ix.programIdIndex);
      return programId?.equals(ELIGIBILITY_CREDENTIAL_PROGRAM_ID);
    });
    const wallet = topLevelIx
      ? accountKeys.get(topLevelIx.accountKeyIndexes[WALLET_ACCOUNT_INDEX])?.toBase58() ?? null
      : null;

    recordCredentialActivity({
      type: "credential_activity",
      action: isIssue ? "issued" : "revoked",
      wallet,
      signature: logs.signature,
      timestamp: Date.now(),
    });
    console.log(`[credential] ${isIssue ? "issued" : "revoked"} -- ${wallet ?? "?"} (${logs.signature})`);
  } catch (err) {
    console.error(`Failed to parse credential transaction ${logs.signature}:`, err);
  }
}

/**
 * Periodically counts wallets currently holding a Valid, unexpired
 * credential -- real-time log watching tells us about *activity*, but the
 * dashboard's headline count needs the current, settled state, which is
 * cheapest to just re-derive from the chain directly rather than maintain
 * incrementally (issuance can overwrite/refresh an existing credential, so
 * a naive increment-on-issue counter would double-count).
 */
export function startCredentialCountPolling(connection: Connection): void {
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../target/idl/eligibility_credential.json"), "utf-8"),
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const program = new Program(idl as Idl, provider);

  const poll = async () => {
    try {
      const all = await (
        program.account as never as {
          eligibilityCredential: {
            all: () => Promise<{ account: { status: Record<string, unknown>; expiresAt: anchor.BN } }[]>;
          };
        }
      ).eligibilityCredential.all();

      const nowSecs = Math.floor(Date.now() / 1000);
      const count = all.filter(
        ({ account }) => "valid" in account.status && account.expiresAt.toNumber() > nowSecs,
      ).length;
      updateCredentialedWalletCount(count);
    } catch (err) {
      console.error("Failed to poll credentialed wallet count:", err);
    }
  };

  void poll();
  setInterval(poll, CREDENTIAL_POLL_INTERVAL_MS);
}
