use anchor_lang::prelude::*;

/// Real schema — see progress.md §2. Replaces the `WalletGate` placeholder
/// that used to live in `transfer-hook`.
#[account]
#[derive(InitSpace)]
pub struct EligibilityCredential {
    pub wallet: Pubkey,
    pub policy_id: [u8; 32],
    pub issuer: Pubkey,
    pub status: CredentialStatus,
    pub issued_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CredentialStatus {
    Valid,
    Revoked,
    Expired,
}

/// Holds the address of the authority allowed to issue/revoke credentials
/// (stands in for the Arcium-attested eligibility result in the real flow —
/// in production this would be a program-derived authority gated by the MPC
/// computation result, not a single keypair).
#[account]
#[derive(InitSpace)]
pub struct IssuerConfig {
    pub is_initialised: bool,
    pub issuer: Pubkey,
}
