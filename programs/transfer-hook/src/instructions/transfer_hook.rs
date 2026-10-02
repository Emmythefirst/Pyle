use {
    crate::error::GateError,
    anchor_lang::prelude::*,
    anchor_spl::{
        token_2022::spl_token_2022::{
            extension::{
                transfer_hook::TransferHookAccount, BaseStateWithExtensions,
                PodStateWithExtensionsMut,
            },
            pod::PodAccount,
        },
        token_interface::{Mint, TokenAccount},
    },
    eligibility_credential::{CredentialStatus, EligibilityCredential, POLICY_US_ACCREDITED},
};

// Execute account order is fixed by the transfer-hook interface:
// [source, mint, destination, source_owner, validation, ...extra accounts].
// Our extra accounts are, in order: the eligibility-credential program id
// (needed so the credential PDA below can be resolved as an *external* PDA —
// see initialise_extra_account_metas_list.rs) and the credential PDA itself.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: source token account; raw so we can read its
    /// TransferHookAccount extension state below
    #[account()]
    pub source_token_account: UncheckedAccount<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Typed so we can read `.owner` (the recipient/buyer) directly instead
    /// of manual byte parsing — must resolve to the same bytes the
    /// extra-account-metas list points a generic resolver at (offset 32).
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: source account's owner/delegate — required by interface
    /// position, unused by our recipient-gated design
    pub owner: UncheckedAccount<'info>,

    /// CHECK: extra account metas list
    #[account(
        seeds = [b"extra-account-metas", token_mint.key().as_ref()],
        bump,
    )]
    pub extra_account_metas_list: UncheckedAccount<'info>,

    /// CHECK: used only as the owning-program anchor for the external
    /// `credential` PDA below; identity enforced by the `address` constraint
    #[account(address = eligibility_credential::ID)]
    pub eligibility_credential_program: UncheckedAccount<'info>,

    /// CHECK: never initialized — exists purely so its address (= POLICY_US_ACCREDITED's
    /// 32 bytes, reinterpreted as a Pubkey) can feed `credential`'s seed derivation below.
    /// See initialise_extra_account_metas_list.rs for why a literal seed won't fit.
    #[account(address = Pubkey::new_from_array(POLICY_US_ACCREDITED))]
    pub policy_marker: UncheckedAccount<'info>,

    /// The buyer's eligibility credential, owned by the sibling
    /// `eligibility-credential` program. Anchor's `Account<'info, T>` checks
    /// both the discriminator and that the account is owned by
    /// `EligibilityCredential::owner()` (== eligibility_credential::ID), so
    /// a missing credential fails here with `AccountNotInitialized` before
    /// `assert_eligible` ever runs.
    #[account(
        seeds = [
            b"eligibility",
            destination_token_account.owner.as_ref(),
            POLICY_US_ACCREDITED.as_ref(),
        ],
        bump,
        seeds::program = eligibility_credential_program.key(),
    )]
    pub credential: Account<'info, EligibilityCredential>,
}

impl<'info> TransferHook<'info> {
    pub fn assert_eligible(&self) -> Result<()> {
        match self.credential.status {
            CredentialStatus::Revoked => return err!(GateError::CredentialRevoked),
            CredentialStatus::Expired => return err!(GateError::CredentialExpired),
            CredentialStatus::Valid => {}
        }

        if Clock::get()?.unix_timestamp >= self.credential.expires_at {
            return err!(GateError::CredentialExpired);
        }

        Ok(())
    }

    /// Token-2022 flips this flag on the source account immediately before
    /// CPI-ing into the hook and unsets it right after, so this rejects any
    /// direct call to `transfer_hook` outside of a real transfer.
    pub fn assert_is_transferring(&self) -> Result<()> {
        let source_token_info = self.source_token_account.to_account_info();
        let mut account_data_ref = source_token_info.try_borrow_mut_data()?;
        let account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut account_data_ref)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let account_extension = account
            .get_extension::<TransferHookAccount>()
            .map_err(|_| ProgramError::InvalidAccountData)?;

        if !bool::from(account_extension.transferring) {
            return err!(GateError::IsNotCurrentlyTransferring);
        }

        Ok(())
    }
}
