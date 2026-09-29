use anchor_lang::prelude::*;

#[error_code]
pub enum GateError {
    #[msg("The token is not currently transferring")]
    IsNotCurrentlyTransferring,

    #[msg("Recipient wallet is not eligible to receive this token")]
    NotAllowed,
}
