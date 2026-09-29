use anchor_lang::prelude::*;

/// Placeholder for the real EligibilityCredential (progress.md §2) — a single
/// bool instead of the full policy/status/expiry schema, keyed on the
/// recipient wallet, so the hook <-> DBC <-> DAMM v2 wiring can be proven
/// before the Arcium-backed credential exists.
#[account]
#[derive(InitSpace)]
pub struct WalletGate {
    pub wallet: Pubkey,
    pub allowed: bool,
}

#[account]
#[derive(InitSpace)]
pub struct AdminConfig {
    pub is_initialised: bool,
    pub admin: Pubkey,
}
