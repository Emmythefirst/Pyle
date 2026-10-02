use {crate::state::IssuerConfig, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct ConfigureIssuer<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,

    /// CHECK: the new issuer authority
    #[account(mut)]
    pub new_issuer: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = issuer,
        space = 8 + IssuerConfig::INIT_SPACE,
        seeds = [b"issuer-config"],
        bump
    )]
    pub issuer_config: Account<'info, IssuerConfig>,

    pub system_program: Program<'info, System>,
}

impl<'info> ConfigureIssuer<'info> {
    pub fn is_issuer(&self) -> Result<()> {
        if self.issuer_config.is_initialised {
            require_keys_eq!(self.issuer.key(), self.issuer_config.issuer);
            require_keys_neq!(self.issuer.key(), self.new_issuer.key());
        }
        Ok(())
    }

    pub fn configure_issuer(&mut self) -> Result<()> {
        self.issuer_config.set_inner(IssuerConfig {
            issuer: self.new_issuer.key(),
            is_initialised: true,
        });
        Ok(())
    }
}
