import {
  BlockedTransferEvent,
  CredentialActivityEvent,
  CredentialedWalletCountEvent,
  PoolStateEvent,
  PyleEvent,
  SuccessfulBuyEvent,
} from "./types.js";

// In-memory only -- this is a live dashboard feed, not a system of record
// (the chain itself is that). A restart loses history, which is fine: the
// chain can always be re-queried for current state (pool, credential count),
// and the feed is about what's happening *now*, not an audit log.
const MAX_FEED_LENGTH = 200;

export interface PyleState {
  blockedTransfers: BlockedTransferEvent[];
  successfulBuys: SuccessfulBuyEvent[];
  credentialActivity: CredentialActivityEvent[];
  poolState: PoolStateEvent;
  credentialedWalletCount: number;
}

export const state: PyleState = {
  blockedTransfers: [],
  successfulBuys: [],
  credentialActivity: [],
  poolState: {
    type: "pool_state",
    configured: false,
    quoteReserve: null,
    migrationQuoteThreshold: null,
    percentComplete: null,
  },
  credentialedWalletCount: 0,
};

type Listener = (event: PyleEvent) => void;
const listeners = new Set<Listener>();

export function onEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function broadcast(event: PyleEvent): void {
  for (const listener of listeners) listener(event);
}

function pushBounded<T>(arr: T[], item: T): void {
  arr.unshift(item);
  if (arr.length > MAX_FEED_LENGTH) arr.length = MAX_FEED_LENGTH;
}

export function recordBlockedTransfer(event: BlockedTransferEvent): void {
  pushBounded(state.blockedTransfers, event);
  broadcast(event);
}

export function recordSuccessfulBuy(event: SuccessfulBuyEvent): void {
  pushBounded(state.successfulBuys, event);
  broadcast(event);
}

export function recordCredentialActivity(event: CredentialActivityEvent): void {
  pushBounded(state.credentialActivity, event);
  broadcast(event);
}

export function updatePoolState(event: PoolStateEvent): void {
  state.poolState = event;
  broadcast(event);
}

export function updateCredentialedWalletCount(count: number): void {
  state.credentialedWalletCount = count;
  const event: CredentialedWalletCountEvent = { type: "credentialed_wallet_count", count };
  broadcast(event);
}
