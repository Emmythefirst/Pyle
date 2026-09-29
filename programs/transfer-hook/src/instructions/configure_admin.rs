use {crate::state::AdminConfig, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct ConfigureAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: the new admin
    #[account(mut)]
    pub new_admin: UncheckedAccount<'info>,

    /// Holds the address of the admin authorized to toggle wallet gates
    /// (stands in for the credential issuer authority in the real design).
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AdminConfig::INIT_SPACE,
        seeds = [b"admin-config"],
        bump
    )]
    pub admin_config: Account<'info, AdminConfig>,

    pub system_program: Program<'info, System>,
}

impl<'info> ConfigureAdmin<'info> {
    pub fn is_admin(&self) -> Result<()> {
        if self.admin_config.is_initialised {
            require_keys_eq!(self.admin.key(), self.admin_config.admin);
            require_keys_neq!(self.admin.key(), self.new_admin.key());
        }
        Ok(())
    }

    pub fn configure_admin(&mut self) -> Result<()> {
        self.admin_config.set_inner(AdminConfig {
            admin: self.new_admin.key(),
            is_initialised: true,
        });
        Ok(())
    }
}
