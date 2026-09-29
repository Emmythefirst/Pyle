use {
    crate::state::{AdminConfig, WalletGate},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
pub struct SetAllowed<'info> {
    /// admin authorized to toggle gates (issuer authority stand-in)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: the wallet (recipient) whose gate is being set
    pub wallet: UncheckedAccount<'info>,

    #[account(
        has_one = admin,
        seeds = [b"admin-config"],
        bump,
    )]
    pub admin_config: Account<'info, AdminConfig>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + WalletGate::INIT_SPACE,
        seeds = [b"gate", wallet.key().as_ref()],
        bump,
    )]
    pub wallet_gate: Account<'info, WalletGate>,

    pub system_program: Program<'info, System>,
}

impl<'info> SetAllowed<'info> {
    pub fn set_allowed(&mut self, allowed: bool) -> Result<()> {
        self.wallet_gate.set_inner(WalletGate {
            wallet: self.wallet.key(),
            allowed,
        });
        Ok(())
    }
}
