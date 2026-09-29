use {
    crate::{error::GateError, state::WalletGate},
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
};

// Execute account order is fixed by the transfer-hook interface:
// [source, mint, destination, source_owner, validation, ...extra accounts].
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

    #[account(
        seeds = [b"gate", destination_token_account.owner.as_ref()],
        bump,
    )]
    pub wallet_gate: Account<'info, WalletGate>,
}

impl<'info> TransferHook<'info> {
    pub fn assert_allowed(&self) -> Result<()> {
        if !self.wallet_gate.allowed {
            return err!(GateError::NotAllowed);
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
