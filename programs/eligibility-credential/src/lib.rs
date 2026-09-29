use anchor_lang::prelude::*;

declare_id!("HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq");

#[program]
pub mod eligibility_credential {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
