use {
    anchor_lang::{
        prelude::*,
        system_program::{create_account, CreateAccount},
    },
    anchor_spl::token_interface::Mint,
    spl_tlv_account_resolution::{
        account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
    },
    spl_transfer_hook_interface::instruction::ExecuteInstruction,
};

#[derive(Accounts)]
pub struct InitializeExtraAccountMetas<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: extra account metas list, initialized manually below
    #[account(
        mut,
        seeds = [b"extra-account-metas", token_mint.key().as_ref()],
        bump,
    )]
    pub extra_account_metas_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetas<'info> {
    pub fn initialize_extra_account_metas_list(
        &self,
        bumps: InitializeExtraAccountMetasBumps,
    ) -> Result<()> {
        // The recipient (destination token account owner) is what Pyle gates
        // on, not the sender — a buyer's eligibility, not the seller's.
        // Token-2022's Execute account list is fixed as
        // [source, mint, destination, owner, validation, ...extra], so the
        // destination token account is always index 2; its `owner` field
        // sits at byte offset 32 in the base SPL Token account layout
        // (mint: 0..32, owner: 32..64), which Token-2022's base state keeps
        // byte-compatible for extension-carrying accounts too.
        let account_metas = vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"gate".to_vec(),
                },
                Seed::AccountData {
                    account_index: 2,
                    data_index: 32,
                    length: 32,
                },
            ],
            false, // is_signer
            false, // is_writable
        )
        .map_err(|_| ProgramError::InvalidArgument)?];

        let account_size = ExtraAccountMetaList::size_of(account_metas.len())
            .map_err(|_| ProgramError::InvalidAccountData)? as u64;
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        let mint = self.token_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            mint.as_ref(),
            &[bumps.extra_account_metas_list],
        ]];

        create_account(
            CpiContext::new(
                self.system_program.key(),
                CreateAccount {
                    from: self.payer.to_account_info(),
                    to: self.extra_account_metas_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            &crate::ID,
        )?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut self.extra_account_metas_list.try_borrow_mut_data()?,
            &account_metas,
        )
        .map_err(|_| ProgramError::InvalidAccountData)?;

        Ok(())
    }
}
