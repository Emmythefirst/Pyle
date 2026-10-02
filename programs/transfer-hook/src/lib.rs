mod error;
mod instructions;

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

    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_metas_list(
        ctx: Context<InitializeExtraAccountMetas>,
    ) -> Result<()> {
        ctx.accounts.initialize_extra_account_metas_list(ctx.bumps)
    }

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        ctx.accounts.assert_is_transferring()?;
        ctx.accounts.assert_eligible()
    }
}
