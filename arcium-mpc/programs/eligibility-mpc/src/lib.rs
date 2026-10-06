use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::{check_args, circuit_hash};

declare_id!("4Fdcz9uK5SKnH5X5XAfwfH1bD1oefpz3LLLRbaN7zTbh");

const COMP_DEF_OFFSET_CHECK_ELIGIBILITY: u32 = comp_def_offset("check_eligibility_v2");

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
                source: "https://raw.githubusercontent.com/Emmythefirst/Pyle/main/arcium-mpc/build/check_eligibility_v2.arcis".to_string(),
                hash: circuit_hash!("check_eligibility_v2"),
            })),
        )?;
        Ok(())
    }

    // ─── One-time setup: create the two accounts check_eligibility needs ──
    //
    // Split out from check_eligibility deliberately (progress.md §12.9):
    // combining account-creation CPIs (init_if_needed) with later reads of
    // *other* accounts in the same instruction crashes at runtime under
    // anchor-lang 1.0.2 (arcium-anchor@0.15.0's hard-pinned version) --
    // root-caused to a real, upstream, already-fixed-in-1.2.0 bug. By the
    // time check_eligibility runs, both accounts already exist, so its own
    // try_accounts triggers zero creation CPIs. `wallet` is taken as an
    // explicit argument rather than read via `ctx.accounts.payer.key()`
    // after the CPIs below, since that exact read is what crashed.
    pub fn init_eligibility_accounts(
        ctx: Context<InitEligibilityAccounts>,
        wallet: Pubkey,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        ctx.accounts.attestation_account.wallet = wallet;
        ctx.accounts.attestation_account.bump = ctx.bumps.attestation_account;
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
        #[args("check_eligibility_v2")]
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

    #[arcium_callback(encrypted_ix = "check_eligibility_v2")]
    pub fn check_eligibility_callback(
        ctx: Context<CheckEligibilityCallback>,
        output: SignedComputationOutputs<CheckEligibilityOutput>,
    ) -> Result<()> {
        let eligible = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckEligibilityOutput { field_0 }) => field_0,
            // Propagate the real error instead of masking it -- see
            // progress.md §12.10 for why this was worth separating out.
            Err(e) => {
                msg!("verify_output failed: {:?}", e);
                return Err(e);
            }
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

#[init_computation_definition_accounts("check_eligibility_v2", payer)]
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

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct InitEligibilityAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        space = ATTESTATION_ACCOUNT_SPACE,
        payer = payer,
        seeds = [b"eligibility-attestation", wallet.as_ref()],
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

    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("check_eligibility_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckEligibility<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Pre-created by init_eligibility_accounts -- no init_if_needed here, so
    // try_accounts for this instruction triggers zero creation CPIs.
    //
    // Boxed throughout this struct (not just the two already boxed below) --
    // a second, distinct stack-overflow crash (progress.md §12.9) showed up
    // even with zero CPIs involved, consistent with try_accounts for this
    // 13-field struct genuinely exceeding the 4096-byte BPF stack frame
    // limit -- the same class of issue pool_account/clock_account were
    // already boxed for, just not everywhere it turned out to matter.
    #[account(
        mut,
        seeds = [b"eligibility-attestation", payer.key().as_ref()],
        bump = attestation_account.bump,
    )]
    pub attestation_account: Box<Account<'info, EligibilityAttestation>>,

    #[account(
        mut,
        seeds = [&SIGN_PDA_SEED],
        bump = sign_pda_account.bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

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
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,

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

#[callback_accounts("check_eligibility_v2")]
#[derive(Accounts)]
pub struct CheckEligibilityCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_ELIGIBILITY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: computation_account, checked by arcium program.
    pub computation_account: UncheckedAccount<'info>,

    #[account(
        address = derive_cluster_pda!(mxe_account)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,

    #[account(address = anchor_lang::solana_program::pubkey::pubkey!("Sysvar1nstructions1111111111111111111111111"))]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: UncheckedAccount<'info>,

    // Extra account: the attestation to write the revealed result into
    #[account(
        mut,
        seeds = [b"eligibility-attestation", attestation_account.wallet.as_ref()],
        bump = attestation_account.bump,
    )]
    pub attestation_account: Box<Account<'info, EligibilityAttestation>>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct EligibilityComputedEvent {
    pub wallet: Pubkey,
    pub eligible: bool,
}
