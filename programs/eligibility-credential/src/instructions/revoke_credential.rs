use {
    crate::state::{CredentialStatus, EligibilityCredential, IssuerConfig},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
pub struct RevokeCredential<'info> {
    pub issuer: Signer<'info>,

    #[account(
        has_one = issuer,
        seeds = [b"issuer-config"],
        bump,
    )]
    pub issuer_config: Account<'info, IssuerConfig>,

    #[account(mut)]
    pub credential: Account<'info, EligibilityCredential>,
}

impl<'info> RevokeCredential<'info> {
    pub fn revoke_credential(&mut self) -> Result<()> {
        self.credential.status = CredentialStatus::Revoked;
        Ok(())
    }
}
