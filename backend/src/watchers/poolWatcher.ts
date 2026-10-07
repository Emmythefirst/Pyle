import { Connection } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { DBC_POOL_ADDRESS, POOL_POLL_INTERVAL_MS } from "../config.js";
import { updatePoolState } from "../state.js";

/**
 * Curve progress toward graduation (progress.md §1's dashboard
 * requirement). Polled, not log-subscribed -- unlike transfer/credential
 * activity, this is a plain account-state read with no discrete "event" to
 * subscribe to, and curve progress only needs to be roughly live (every few
 * seconds), not instruction-by-instruction.
 *
 * No single demo pool persists across runs (progress.md §9-§11 -- each test
 * creates and abandons its own), so this stays idle and honestly reports
 * "not configured" until DBC_POOL_ADDRESS is set to whatever pool the demo
 * is actually using.
 */
export function startPoolPolling(connection: Connection): void {
  if (!DBC_POOL_ADDRESS) {
    console.log("DBC_POOL_ADDRESS not set -- pool/curve progress will report as unconfigured.");
    return;
  }

  const poolAddress = DBC_POOL_ADDRESS;
  const dbcClient = new DynamicBondingCurveClient(connection, "confirmed");
  console.log(`Watching DBC pool ${poolAddress.toBase58()} for curve progress...`);

  const poll = async () => {
    try {
      const pool = await dbcClient.state.getPool(poolAddress);
      if (!pool) return;

      const poolConfig = await dbcClient.state.getPoolConfig(pool.poolState.config);
      if (!poolConfig) return;
      const quoteReserve = pool.poolState.quoteReserve;
      const threshold = poolConfig.migrationQuoteThreshold;

      // The DBC pool account itself stays queryable after migration (just
      // "complete"), so quoteReserve/threshold alone can't tell the
      // dashboard whether the real migrateToDammV2 call has actually
      // happened yet -- check the derived DAMM v2 pool's existence
      // directly, the same way dbcGraduate.ts decides whether to skip
      // re-migrating.
      const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfig.migrationFeeOption];
      const dammV2PoolAddress = deriveDammV2PoolAddress(dammConfig, pool.poolState.baseMint, NATIVE_MINT);
      const dammV2PoolInfo = await connection.getAccountInfo(dammV2PoolAddress);

      updatePoolState({
        type: "pool_state",
        configured: true,
        quoteReserve: quoteReserve.toString(),
        migrationQuoteThreshold: threshold.toString(),
        percentComplete: threshold.isZero()
          ? null
          : Math.min(100, quoteReserve.muln(100).div(threshold).toNumber()),
        migrated: !!dammV2PoolInfo,
        dammV2Pool: dammV2PoolInfo ? dammV2PoolAddress.toBase58() : null,
      });
    } catch (err) {
      console.error("Failed to poll DBC pool state:", err);
    }
  };

  void poll();
  setInterval(poll, POOL_POLL_INTERVAL_MS);
}
