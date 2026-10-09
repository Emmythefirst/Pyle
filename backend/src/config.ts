import { PublicKey } from "@solana/web3.js";
import { DBC_POOL } from "./dbcPool.js";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// Railway (and most PaaS hosts) inject PORT and require the app to listen on
// it; WS_PORT stays as an explicit override for local dev.
export const WS_PORT = Number(process.env.WS_PORT ?? process.env.PORT ?? 8787);

export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  process.env.TRANSFER_HOOK_PROGRAM_ID ?? "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);
export const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey(
  process.env.ELIGIBILITY_CREDENTIAL_PROGRAM_ID ?? "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
);

// Defaults to the persistent pool scripts/eligibility-test/setup-demo-dbc-pool.ts
// created (see dbcPool.ts) -- overridable via env for pointing at a
// different pool without a code change.
export const DBC_POOL_ADDRESS = process.env.DBC_POOL_ADDRESS
  ? new PublicKey(process.env.DBC_POOL_ADDRESS)
  : DBC_POOL;

// Must byte-for-byte match eligibility-credential's POLICY_US_ACCREDITED.
export const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);

export const POOL_POLL_INTERVAL_MS = Number(process.env.POOL_POLL_INTERVAL_MS ?? 5000);
export const CREDENTIAL_POLL_INTERVAL_MS = Number(
  process.env.CREDENTIAL_POLL_INTERVAL_MS ?? 10000,
);
