mod instructions;
mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq");

pub use state::{CredentialStatus, EligibilityCredential, IssuerConfig};

/// The only policy this hackathon build implements — "US accredited
/// investor" — kept as a fixed-size identifier rather than a plain enum so
/// the schema stays extensible to other policies later without a migration,
/// even though only this one value is ever issued (see progress.md §2's
/// non-goals on multi-policy composition).
pub const POLICY_US_ACCREDITED: [u8; 32] = {
    let mut bytes = [0u8; 32];
    let src = b"US_ACCREDITED";
    let mut i = 0;
    while i < src.len() {
        bytes[i] = src[i];
        i += 1;
    }
    bytes
};

#[program]
pub mod eligibility_credential {
    use super::*;

    pub fn configure_issuer(ctx: Context<ConfigureIssuer>) -> Result<()> {
        ctx.accounts.is_issuer()?;
        ctx.accounts.configure_issuer()
    }

    pub fn issue_credential(
        ctx: Context<IssueCredential>,
        policy_id: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        ctx.accounts
            .issue_credential(policy_id, expires_at, ctx.bumps)
    }

    pub fn revoke_credential(ctx: Context<RevokeCredential>) -> Result<()> {
        ctx.accounts.revoke_credential()
    }
}
