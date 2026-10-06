import { PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const WS_PORT = Number(process.env.WS_PORT ?? 8787);

export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  process.env.TRANSFER_HOOK_PROGRAM_ID ?? "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);
export const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey(
  process.env.ELIGIBILITY_CREDENTIAL_PROGRAM_ID ?? "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
);

// Set once a pool exists to demo against (created fresh per demo run --
// see progress.md §9-§11 on why there's no single persistent pool). The
// pool watcher simply stays idle and reports no curve data if this is unset,
// rather than fabricating a fake one.
export const DBC_POOL_ADDRESS = process.env.DBC_POOL_ADDRESS
  ? new PublicKey(process.env.DBC_POOL_ADDRESS)
  : null;

// Must byte-for-byte match eligibility-credential's POLICY_US_ACCREDITED.
export const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);

export const POOL_POLL_INTERVAL_MS = Number(process.env.POOL_POLL_INTERVAL_MS ?? 5000);
export const CREDENTIAL_POLL_INTERVAL_MS = Number(
  process.env.CREDENTIAL_POLL_INTERVAL_MS ?? 10000,
);
