use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::{check_args, circuit_hash};

declare_id!("4Fdcz9uK5SKnH5X5XAfwfH1bD1oefpz3LLLRbaN7zTbh");

const COMP_DEF_OFFSET_CHECK_ELIGIBILITY: u32 = comp_def_offset("check_eligibility");

// space = discriminator(8) + wallet(32) + eligible(1) + computed_at(8) + bump(1)
const ATTESTATION_ACCOUNT_SPACE: usize = 8 + 32 + 1 + 8 + 1;

#[arcium_program]
pub mod eligibility_mpc {
    use super::*;

    // ─── Comp def initializer ───────────────────────────────────────────────

    pub fn init_check_eligibility_comp_def(
        ctx: Context<InitCheckEligibilityCompDef>,
    ) -> Result<()> {
        init_computation_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://raw.githubusercontent.com/Emmythefirst/Pyle/main/arcium-mpc/build/check_eligibility.arcis".to_string(),
                hash: circuit_hash!("check_eligibility"),
            })),
        )?;
        Ok(())
    }

    // ─── Check eligibility: queue the MPC computation ──────────────────────

    #[check_args]
    pub fn check_eligibility(
        ctx: Context<CheckEligibility>,
        computation_offset: u64,
        income: [u8; 32],
        net_worth: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // BLOCKED (progress.md §12.6): reading/writing any account field here,
        // including a plain ctx.accounts.payer.key(), crashes at runtime with
        // "Access violation ... in unallocated region" -- root-caused via
        // checkpoint logging to a real anchor-lang 1.0.2 bug in init_if_needed
        // codegen (fixed in 1.2.0 by anchor-lang PR #4675), which
        // arcium-anchor@0.15.0 hard-pins us to. A vendored-patch workaround
        // was attempted and reverted: it fixes this conflict but immediately
        // hits the same sha2/digest version-bucket conflict that forced this
        // workspace to be isolated from Pyle's main one in the first place.
        let attestation = &mut ctx.accounts.attestation_account;
        attestation.wallet = ctx.accounts.payer.key();
        attestation.bump = ctx.bumps.attestation_account;

        #[args("check_eligibility")]
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(income)
            .encrypted_u64(net_worth)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CheckEligibilityCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.attestation_account.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
            200_000,
        )?;
        Ok(())
    }

    // ─── Callback: receives the revealed (plaintext) eligibility bit ───────

    #[arcium_callback(encrypted_ix = "check_eligibility")]
    pub fn check_eligibility_callback(
        ctx: Context<CheckEligibilityCallback>,
        output: SignedComputationOutputs<CheckEligibilityOutput>,
    ) -> Result<()> {
        let eligible = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckEligibilityOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let attestation = &mut ctx.accounts.attestation_account;
        attestation.eligible = eligible;
        attestation.computed_at = Clock::get()?.unix_timestamp;

        emit!(EligibilityComputedEvent {
            wallet: attestation.wallet,
            eligible,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain account
// ─────────────────────────────────────────────────────────────────────────────

/// Holds only the *result* of a private eligibility check -- never the raw
/// income/net_worth inputs, which exist nowhere outside the MPC computation
/// itself. An off-chain issuer step (script now, backend service later --
/// see progress.md §3) watches `EligibilityComputedEvent` / reads this
/// account and, if `eligible`, calls the separate `eligibility-credential`
/// program's `issue_credential`. Kept as a fully separate program/workspace
/// from `eligibility-credential` deliberately -- see progress.md §12 for why
/// (arcium-anchor pins anchor-lang 0.32.1, which conflicts transitively with
/// anchor-lang 1.2.0 at the Cargo dependency-resolution level, not just at
/// the Anchor-CPI level).
#[account]
pub struct EligibilityAttestation {
    pub wallet: Pubkey,
    pub eligible: bool,
    pub computed_at: i64,
    pub bump: u8,
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction contexts
// ─────────────────────────────────────────────────────────────────────────────

#[init_computation_definition_accounts("check_eligibility", payer)]
#[derive(Accounts)]
pub struct InitCheckEligibilityCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("check_eligibility", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckEligibility<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = ATTESTATION_ACCOUNT_SPACE,
        payer = payer,
        seeds = [b"eligibility-attestation", payer.key().as_ref()],
        bump,
    )]
    pub attestation_account: Account<'info, EligibilityAttestation>,

    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,

    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_ELIGIBILITY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Box<Account<'info, FeePool>>,

    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("check_eligibility")]
#[derive(Accounts)]
pub struct CheckEligibilityCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_ELIGIBILITY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Account<'info, Cluster>,

    #[account(address = anchor_lang::solana_program::pubkey::pubkey!("Sysvar1nstructions1111111111111111111111111"))]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: UncheckedAccount<'info>,

    // Extra account: the attestation to write the revealed result into
    #[account(
        mut,
        seeds = [b"eligibility-attestation", attestation_account.wallet.as_ref()],
        bump = attestation_account.bump,
    )]
    pub attestation_account: Account<'info, EligibilityAttestation>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct EligibilityComputedEvent {
    pub wallet: Pubkey,
    pub eligible: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
}
