use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Test income/net-worth figures only -- see progress.md §1's explicit
    /// non-goal on real KYC/bank data. The MPC cluster jointly computes the
    /// eligibility predicate without any single node (or the chain) ever
    /// seeing these raw numbers; only the final boolean is revealed.
    pub struct EligibilityInput {
        pub income: u64,
        pub net_worth: u64,
    }

    const US_ACCREDITED_INCOME_THRESHOLD: u64 = 200_000;
    const US_ACCREDITED_NET_WORTH_THRESHOLD: u64 = 1_000_000;

    /// Reveals only the pass/fail bit -- `.reveal()` makes the result
    /// chain-visible (vs. the default Enc<Shared, T>, which only the
    /// requesting client could decrypt), so the eligibility-mpc program's
    /// callback can act on it directly without learning income or net_worth.
    ///
    /// Named _v2 (progress.md §12.10): the original `check_eligibility`
    /// comp-def account was created against an earlier circuit build (before
    /// the arcis 0.8.5 -> 0.15.0 upgrade) and stored that build's hash
    /// on-chain; rebuilding the circuit changed its hash but comp-def
    /// accounts can't be updated in place, so every computation using the
    /// old comp-def silently failed cluster-side (reported back only as a
    /// generic "aborted computation", no specific error). A fresh name
    /// forces a fresh comp-def PDA (comp_def_offset is a hash of the name).
    #[instruction]
    pub fn check_eligibility_v2(input_ctxt: Enc<Shared, EligibilityInput>) -> bool {
        let input = input_ctxt.to_arcis();
        let eligible = input.income > US_ACCREDITED_INCOME_THRESHOLD
            || input.net_worth > US_ACCREDITED_NET_WORTH_THRESHOLD;
        eligible.reveal()
    }
}
