mod error;
mod instructions;
mod state;

use anchor_lang::prelude::*;
use instructions::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::{
    ExecuteInstruction, InitializeExtraAccountMetaListInstruction,
};

declare_id!("F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z");

#[program]
pub mod transfer_hook {
    use super::*;

    pub fn configure_admin(ctx: Context<ConfigureAdmin>) -> Result<()> {
        ctx.accounts.is_admin()?;
        ctx.accounts.configure_admin()
    }

    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_metas_list(
        ctx: Context<InitializeExtraAccountMetas>,
    ) -> Result<()> {
        ctx.accounts.initialize_extra_account_metas_list(ctx.bumps)
    }

    /// Placeholder for the real EligibilityCredential check (see progress.md).
    /// Gates a specific recipient wallet on/off so we can empirically verify
    /// the hook keeps firing through DBC -> DAMM v2 graduation before wiring
    /// up the real Arcium-backed credential.
    pub fn set_allowed(ctx: Context<SetAllowed>, allowed: bool) -> Result<()> {
        ctx.accounts.set_allowed(allowed)
    }

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        ctx.accounts.assert_is_transferring()?;
        ctx.accounts.assert_allowed()
    }
}
