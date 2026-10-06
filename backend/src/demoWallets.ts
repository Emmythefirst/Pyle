import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The frontend's terminal switches between three prepared identities rather
// than connecting an arbitrary wallet (progress.md's frontend-build notes) --
// the same three keypairs scripts/eligibility-test and the Arcium MPC client
// already use, so every "real" action (buy, verify, credential lookup) in
// the UI acts on exactly the wallets the rest of the project's scripts do.
export type WalletKey = "A" | "B" | "C";

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const ELIGIBILITY_TEST_DIR = path.resolve(__dirname, "../../scripts/eligibility-test");

export const DEMO_WALLETS: Record<WalletKey, Keypair> = {
  A: loadKeypair(path.join(ELIGIBILITY_TEST_DIR, "wallet-a-keypair.json")),
  B: loadKeypair(path.join(ELIGIBILITY_TEST_DIR, "wallet-b-keypair.json")),
  C: loadKeypair(path.join(ELIGIBILITY_TEST_DIR, "wallet-c-keypair.json")),
};

// The issuer/treasury/payer identity used throughout the project's scripts --
// configure_issuer was run with this key, and setup-demo-mint.ts minted the
// ACME supply into its token account.
export const TREASURY_KEYPAIR = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));

export function resolveWalletKey(value: string): WalletKey | null {
  return value === "A" || value === "B" || value === "C" ? value : null;
}
