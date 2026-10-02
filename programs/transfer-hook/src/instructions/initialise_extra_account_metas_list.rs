use {
    anchor_lang::{
        prelude::*,
        system_program::{create_account, CreateAccount},
    },
    anchor_spl::token_interface::Mint,
    eligibility_credential::POLICY_US_ACCREDITED,
    spl_tlv_account_resolution::{
        account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
    },
    spl_transfer_hook_interface::instruction::ExecuteInstruction,
};

/// Index, within the full `Execute` account list, of the
/// `eligibility_credential_program` extra account — needed so the
/// `credential` PDA right after it can be resolved as belonging to that
/// *external* program rather than to this hook program. Fixed accounts are
/// [source=0, mint=1, destination=2, owner=3, validation=4], so our first
/// extra account (the program id) lands at index 5.
const ELIGIBILITY_CREDENTIAL_PROGRAM_ACCOUNT_INDEX: u8 = 5;

/// Index of the `policy_marker` extra account — see the comment on its
/// construction below for why it exists.
const POLICY_MARKER_ACCOUNT_INDEX: u8 = 6;

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
        //
        // The credential PDA is owned by the sibling eligibility-credential
        // program, not this one, so it must be resolved as an *external* PDA
        // (`new_external_pda_with_seeds`) against that program's id — which
        // itself has to be supplied as a preceding plain-pubkey extra account
        // for the resolver to find at `ELIGIBILITY_CREDENTIAL_PROGRAM_ACCOUNT_INDEX`.
        //
        // All seed configs for one ExtraAccountMeta must pack into 32 bytes
        // total (spl_tlv_account_resolution::seeds), so `policy_id`'s 32 raw
        // bytes can't be passed as a `Seed::Literal` — that alone costs 34
        // bytes (2 bytes TLV overhead + 32 bytes of content), already over
        // budget before "eligibility" or the destination-owner seed are even
        // added. Instead, `policy_marker` is a plain (never-initialized)
        // extra account whose *address* is simply `policy_id`'s 32 bytes
        // reinterpreted as a Pubkey — `Seed::AccountKey` then contributes
        // those same 32 bytes via a 2-byte seed config, for the exact same
        // effect as `policy_id.as_ref()` at a fraction of the TLV cost. Only
        // the address is ever read; the account need not exist.
        let policy_marker = Pubkey::new_from_array(POLICY_US_ACCREDITED);

        let account_metas = vec![
            ExtraAccountMeta::new_with_pubkey(&eligibility_credential::ID, false, false)
                .map_err(|_| ProgramError::InvalidArgument)?,
            ExtraAccountMeta::new_with_pubkey(&policy_marker, false, false)
                .map_err(|_| ProgramError::InvalidArgument)?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                ELIGIBILITY_CREDENTIAL_PROGRAM_ACCOUNT_INDEX,
                &[
                    Seed::Literal {
                        bytes: b"eligibility".to_vec(),
                    },
                    Seed::AccountData {
                        account_index: 2,
                        data_index: 32,
                        length: 32,
                    },
                    Seed::AccountKey {
                        index: POLICY_MARKER_ACCOUNT_INDEX,
                    },
                ],
                false, // is_signer
                false, // is_writable
            )
            .map_err(|_| ProgramError::InvalidArgument)?,
        ];

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
