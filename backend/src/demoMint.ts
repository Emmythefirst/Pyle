import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Written once by scripts/eligibility-test/setup-demo-mint.ts -- a persistent
// Token-2022 mint with our transfer-hook extension, separate from any DBC
// pool (see that script's comment for why a direct transfer is enough to
// exercise the real hook check without needing bonding-curve economics).
const raw = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../demo-mint.json"), "utf-8"),
) as { mint: string; decimals: number; treasury: string; treasuryAta: string };

export const DEMO_MINT = new PublicKey(raw.mint);
export const DEMO_MINT_DECIMALS = raw.decimals;
export const DEMO_TREASURY = new PublicKey(raw.treasury);
export const DEMO_TREASURY_ATA = new PublicKey(raw.treasuryAta);
