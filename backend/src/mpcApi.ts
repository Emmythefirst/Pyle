import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { WalletKey } from "./demoWallets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCIUM_MPC_DIR = path.resolve(__dirname, "../../arcium-mpc");
const TSX_BIN = path.join(ARCIUM_MPC_DIR, "node_modules/.bin/tsx");

export interface VerifyResult {
  eligible: boolean;
  checkSig: string;
  finalizeSig: string;
  credentialIssued: boolean;
  credentialSig: string | null;
}

/**
 * Real Arcium MPC round trip, run by spawning verify-cli.ts in its own
 * workspace (arcium-mpc is a Cargo-conflict-isolated npm workspace too, see
 * progress.md §12) rather than importing across workspaces. Encryption,
 * queueing, and polling for the real on-chain EligibilityComputedEvent all
 * happen for real inside that process -- this just relays its result.
 */
export function runEligibilityCheck(
  walletKey: WalletKey,
  income: number,
  netWorth: number,
): Promise<VerifyResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX_BIN,
      ["client/verify-cli.ts", walletKey, String(income), String(netWorth)],
      { cwd: ARCIUM_MPC_DIR },
    );

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[verify ${walletKey}] ${text}`);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[verify ${walletKey}] ${chunk.toString()}`);
    });

    child.on("close", (code) => {
      const line = stdout.split("\n").reverse().find((l) => l.startsWith("RESULT_JSON:"));
      if (!line) {
        reject(new Error(`verify-cli exited (code ${code}) without a RESULT_JSON line`));
        return;
      }
      const parsed = JSON.parse(line.slice("RESULT_JSON:".length));
      if (parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      resolve(parsed as VerifyResult);
    });
    child.on("error", reject);
  });
}
