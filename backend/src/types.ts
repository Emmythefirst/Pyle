// Event shapes broadcast over the WebSocket feed. Kept flat and small --
// this is the "Compliance + Market Terminal" dashboard's data source
// (progress.md §1), not a general event bus.

export interface BlockedTransferEvent {
  type: "blocked_transfer";
  wallet: string | null; // null only if the destination account couldn't be resolved
  reason: string;
  amount: string | null; // raw token amount (base units), as a string (can exceed JS safe-int range)
  signature: string;
  timestamp: number;
}

export interface SuccessfulBuyEvent {
  type: "successful_buy";
  wallet: string | null;
  amount: string | null;
  signature: string;
  timestamp: number;
}

export interface CredentialActivityEvent {
  type: "credential_activity";
  action: "issued" | "revoked";
  wallet: string | null;
  signature: string;
  timestamp: number;
}

export interface PoolStateEvent {
  type: "pool_state";
  configured: boolean;
  quoteReserve: string | null;
  migrationQuoteThreshold: string | null;
  percentComplete: number | null;
}

export interface CredentialedWalletCountEvent {
  type: "credentialed_wallet_count";
  count: number;
}

export type PyleEvent =
  | BlockedTransferEvent
  | SuccessfulBuyEvent
  | CredentialActivityEvent
  | PoolStateEvent
  | CredentialedWalletCountEvent;
