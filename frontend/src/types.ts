// Mirrors backend/src/types.ts -- duplicated rather than shared across
// packages since frontend and backend are separate npm workspaces.

export interface BlockedTransferEvent {
  type: "blocked_transfer";
  wallet: string | null;
  reason: string;
  amount: string | null;
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

export interface MpcAttestationEvent {
  type: "mpc_attestation";
  wallet: string;
  eligible: boolean;
  signature: string;
  timestamp: number;
}

export type PyleEvent =
  | BlockedTransferEvent
  | SuccessfulBuyEvent
  | CredentialActivityEvent
  | PoolStateEvent
  | CredentialedWalletCountEvent
  | MpcAttestationEvent;

export interface PyleState {
  blockedTransfers: BlockedTransferEvent[];
  successfulBuys: SuccessfulBuyEvent[];
  credentialActivity: CredentialActivityEvent[];
  poolState: PoolStateEvent;
  credentialedWalletCount: number;
  mpcAttestations: MpcAttestationEvent[];
}

export interface CredentialView {
  wallet: string;
  exists: boolean;
  status?: "Valid" | "Revoked" | "Expired";
  issuedAt?: number;
  expiresAt?: number;
}

export interface BuyResult {
  ok: boolean;
  signature?: string;
  error?: string;
  logs?: string[];
}

export interface VerifyResult {
  eligible: boolean;
  checkSig: string;
  finalizeSig: string;
  credentialIssued: boolean;
  credentialSig: string | null;
}
