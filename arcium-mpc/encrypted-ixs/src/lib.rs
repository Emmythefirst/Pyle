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
    #[instruction]
    pub fn check_eligibility(input_ctxt: Enc<Shared, EligibilityInput>) -> bool {
        let input = input_ctxt.to_arcis();
        let eligible = input.income > US_ACCREDITED_INCOME_THRESHOLD
            || input.net_worth > US_ACCREDITED_NET_WORTH_THRESHOLD;
        eligible.reveal()
    }
}
