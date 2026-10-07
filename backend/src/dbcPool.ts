import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Written once by scripts/eligibility-test/setup-demo-dbc-pool.ts -- a
// persistent Meteora DBC pool with our transfer hook attached and a
// deliberately low migrationQuoteThreshold, so the terminal's real Buy and
// Run graduation actions can complete the curve live (progress.md's
// original brief, demo script requirement #4). Hook-revoked-at-completion
// and migrateToDammV2 mechanics already proven for real in
// scripts/graduation-test -- see progress.md §10.
const raw = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../demo-dbc-pool.json"), "utf-8"),
) as {
  config: string;
  baseMint: string;
  pool: string;
  extraAccountMetasList: string;
  migrationQuoteThreshold: number;
};

export const DBC_CONFIG = new PublicKey(raw.config);
export const DBC_BASE_MINT = new PublicKey(raw.baseMint);
export const DBC_POOL = new PublicKey(raw.pool);
export const DBC_EXTRA_ACCOUNT_METAS_LIST = new PublicKey(raw.extraAccountMetasList);
export const DBC_MIGRATION_QUOTE_THRESHOLD = raw.migrationQuoteThreshold;
