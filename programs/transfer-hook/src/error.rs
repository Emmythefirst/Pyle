use anchor_lang::prelude::*;

#[error_code]
pub enum GateError {
    #[msg("The token is not currently transferring")]
    IsNotCurrentlyTransferring,

    #[msg("Eligibility credential has been revoked")]
    CredentialRevoked,

    #[msg("Eligibility credential has expired")]
    CredentialExpired,
}
