use {
    crate::state::{CredentialStatus, EligibilityCredential, IssuerConfig},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(policy_id: [u8; 32])]
pub struct IssueCredential<'info> {
    /// issuer authority — stands in for the Arcium-attested eligibility
    /// result (progress.md §2); in production this account would only be
    /// allowed to sign after a real MPC computation confirms eligibility
    #[account(mut)]
    pub issuer: Signer<'info>,

    /// CHECK: the investor wallet this credential is issued to
    pub wallet: UncheckedAccount<'info>,

    #[account(
        has_one = issuer,
        seeds = [b"issuer-config"],
        bump,
    )]
    pub issuer_config: Account<'info, IssuerConfig>,

    #[account(
        init_if_needed,
        payer = issuer,
        space = 8 + EligibilityCredential::INIT_SPACE,
        seeds = [b"eligibility", wallet.key().as_ref(), policy_id.as_ref()],
        bump,
    )]
    pub credential: Account<'info, EligibilityCredential>,

    pub system_program: Program<'info, System>,
}

impl<'info> IssueCredential<'info> {
    pub fn issue_credential(
        &mut self,
        policy_id: [u8; 32],
        expires_at: i64,
        bumps: IssueCredentialBumps,
    ) -> Result<()> {
        self.credential.set_inner(EligibilityCredential {
            wallet: self.wallet.key(),
            policy_id,
            issuer: self.issuer.key(),
            status: CredentialStatus::Valid,
            issued_at: Clock::get()?.unix_timestamp,
            expires_at,
            bump: bumps.credential,
        });
        Ok(())
    }
}
