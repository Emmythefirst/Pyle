# Pyle — Progress Log

This file is the single source of truth for project context, decisions, and status across sessions. Update it every time a checklist item is cleared, a bug is hit/fixed, or a non-obvious decision is made — so a fresh session (or a new contributor) can reconstruct full context without re-reading chat history.

---

## 1. Project Briefing (as given at kickoff)

**Hackathon:** Meteora's Dynamic Bonding Curve (DBC) bounty, $20k, part of Colosseum's "Stocklana" hackathon (tokenized stocks on Solana)
**Deadline:** ~3 weeks from kickoff (kickoff: 2026-09-22) — treat every day as scarce
**Project name:** Pyle (Greek πύλη, "gate") — the transfer hook is the gate that checks eligibility before letting a trade through

### The Pitch
> Compliance that's wired directly into a Meteora token's launch lifecycle — the same eligibility policy follows the asset from its bonding curve through graduation into DAMM v2 liquidity, without the launchpad ever holding investor financial data.

**The problem:** tokenized-stock launches on Meteora DBC legally need to restrict buyers to eligible (accredited) investors. The standard fix is a centralized KYC database — a privacy risk and a single point of failure. We enforce eligibility on the asset itself, automatically, without exposing who anyone is.

**The differentiator (stated carefully):** privacy-preserving accredited-investor verification already exists as a category (zkMe's zkPoAI, Civic, Credence on Mantle). We do **not** claim to have invented it. Our claim is narrower and defensible: *"integrating investor eligibility directly into Meteora's DBC-to-DAMM lifecycle, rather than providing a standalone identity credential."* None of the generic identity players touch DBC's graduation mechanics — that's the wedge.

### ⚠️ Verify First — Biggest Technical Risk (Day 1–2, not week 3)

Meteora's docs state a DBC pool's Token-2022 transfer hook is a **pre-migration feature only** — on graduation, Meteora **revokes the transfer-hook program and authority from the mint** so the token can migrate into permissionless DAMM v2 liquidity. If true, our compliance check **cannot literally persist post-graduation** — it only gates the DBC phase.

- **Action:** confirm this directly against the current DBC SDK/docs (and Meteora Discord/Telegram dev channels if ambiguous) before building anything that assumes enforcement survives graduation.
- **If confirmed (likely):** reframe as a *feature*: "Eligibility is enforced during the sensitive early sale; once the asset graduates into deep DAMM v2 liquidity, it trades openly — similar to how real securities are restricted at issuance and become freely tradable later." Do not claim "compliance policy is preserved in DAMM v2" unless a real mechanism is verified.
- **If disconfirmed:** update pitch to the stronger version, but confirm before designing the demo either way.
- **Status: UNVERIFIED — see §4 Open Risks / TODOs. This blocks confident scoping of the hook program and must be resolved before Days 8–14 (hook + DBC integration) begin.**

### Scope — Core Features (must ship, real, not mocked)
1. **Private eligibility check** — client submits test income/net-worth numbers; a real Arcium MPC computation (adapted from GhostID's `store_biometric`/`match_biometric` pattern, swapping "biometric" for "eligibility") jointly computes `income > $200k OR net_worth > $1M` across nodes, returns a boolean. No single party sees raw numbers. Input is simulated test data; computation itself is real, not mocked UI state.
2. **Structured on-chain credential** — not a boolean flag. Schema in §3 below.
3. **Token-2022 transfer hook enforcement** — hook program checks buyer's credential on every transfer against the DBC pool; rejects if missing/expired/revoked.
4. **Meteora DBC launch** via the dedicated SDK path for transfer-hook-enabled tokens (confirm current `dynamic-bonding-curve-sdk` method naming — do not build against a stale/remembered API).
5. **Compliance + Market Terminal dashboard** — live curve progress toward graduation, volume, fees, count of credentialed wallets, and a **live feed of actual blocked transactions** (wallet, reason, amount). Single most persuasive demo element — build it early enough to polish.
6. **Graduation event, live** — see demo script below.

### Explicit Non-Goals (do not build — flag if scope creep is suggested)
- **No AI agent of any kind.** A post-graduation liquidity-management agent was considered and deliberately cut — dilutes the compliance thesis, adds risk, no judging benefit on this track.
- **No multi-policy composer.** Only one policy — US accredited investor — is functionally implemented. Other policy types (jurisdiction, holding period, max allocation, extended expiration windows) are mentioned in prose/docs as *architectural extensibility* only — never built, never shown as clickable UI (a clickable toggle invites a judge to test it and find it's fake).
- **No real KYC/bank integration.** Simulated test inputs only. State explicitly in demo narration that production would plug into a real provider (Civic/SAS-style) and that this system never receives underlying financial data either way.

### Messaging Guardrails (use these exact framings)
| Don't say | Say instead |
|---|---|
| "Nobody's solved private accredited-investor verification" | "Our differentiation is integrating eligibility directly into Meteora's DBC-to-DAMM lifecycle, not the credential itself" |
| "MPC means nobody ever sees the numbers" | "Our launchpad never receives or stores the investor's underlying financial data — only a verifiable eligibility result" |
| "Anonymous investor" | "Private eligibility" — market infrastructure doesn't need financial details; an issuer/regulator might still need identity elsewhere |
| "Compliance policy is preserved through DAMM v2" | **Empirically DISPROVEN on devnet — see §9.** DAMM v2's swap instruction does not invoke the Token-2022 transfer hook at all (confirmed via on-chain transaction inspection, not just source reading). Use the brief's original honest framing: "eligibility is enforced through the DBC phase; the asset trades openly once graduated into deep DAMM v2 liquidity." §8's "stronger claim" was based on source-code reading alone and turned out to be wrong in practice — superseded by §9. |

### Demo Script Requirements
1. **Wallet A** — submits passing test numbers (e.g. income $250k) → gets credential → buys ACME → **success**, shown live on-chain.
2. **Wallet B** — no credential → attempts to buy → **transaction fails**, shown live, blocked-transfer feed logs it (wallet, reason, amount).
3. **Wallet C (optional)** — credential with `expires_at` in the past → buy attempt → rejected for "expired," distinct from "no credential" — proves the status field does real work.
4. **Graduation** — a few more scripted buys push an artificially-low threshold to completion, live on-screen, migrating into DAMM v2.
5. Narrate the post-graduation state honestly per whatever §4 confirms.

### Judging Criteria Alignment (self-check before submitting)
| Criterion | How this project answers it |
|---|---|
| Depth of Meteora integration | Compliance wired into the DBC mint itself (Token-2022 hook), tracks the pool through its actual lifecycle, not just a deploy-and-forget SDK call |
| Technical execution | Real Arcium MPC computation, real on-chain credential, real atomic transaction rejection — nothing UI-mocked |
| Originality/taste | Positioned as lifecycle integration, not "invented private compliance" |
| Impact potential | Credential schema's generic `policy_id` field is a legitimate (if unbuilt) extensibility story |
| Traction/volume | N/A for a 3-week build — lean on demo polish instead |

---

## 2. Data Model

```rust
#[account]
pub struct EligibilityCredential {
    pub wallet: Pubkey,
    pub policy_id: [u8; 32],   // fixed-size identifier, e.g. hash of "US_ACCREDITED"
                                // — generic field on purpose, only one value is ever used
    pub issuer: Pubkey,        // the authority that ran/attested the eligibility check
    pub status: CredentialStatus,
    pub issued_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum CredentialStatus {
    Valid,
    Revoked,
    Expired,
}
```

PDA seeds: `["eligibility", wallet.key(), policy_id]` — extensible per-policy without redesign later, even though only one policy ships.

**Transfer hook program logic** (`Execute` instruction, per Token-2022 transfer-hook spec):
1. Derive the credential PDA for the recipient wallet (buyer receiving the tokenized stock).
2. Load it via `ExtraAccountMetaList` (Token-2022 transfer hooks require pre-registering the extra accounts the hook needs — most common integration gotcha, don't forget it).
3. Check `status == Valid` and `Clock::get()?.unix_timestamp < expires_at`.
4. Pass → allow transfer. Fail → return an error so the whole transaction (the DBC buy) reverts atomically. This atomicity is what makes the demo credible.

Not yet implemented — this is target-state design from the brief, tracked as the Days 3–14 build target.

---

## 3. Tech Stack

- **On-chain:** Anchor 0.32.1 (credential program + transfer hook program), Solana devnet
- **Privacy layer:** Arcium MPC, adapted from GhostID's existing circuits (not yet started)
- **Frontend:** Vite + React + TypeScript, Solana wallet adapter
- **Backend:** lightweight Node/TypeScript service subscribing to program logs, feeds the dashboard's live blocked-transfer feed
- **Deploy:** Vercel (frontend), Railway (backend), Solana devnet (programs)
- **Dev environment:** WSL2 (Linux 6.6.87.2-microsoft-standard-WSL2)

---

## 4. Open Risks / TODOs

- [x] ~~**BLOCKING:** Confirm whether Meteora DBC actually revokes the Token-2022 transfer-hook program/authority on graduation~~ — **RESOLVED 2026-09-23 via a real devnet test, and the answer is: enforcement does not survive graduation, though not for the reason the brief guessed.** DBC doesn't revoke the hook (§8 was right about that). But DAMM v2's swap instruction never invokes it at all — confirmed empirically, see §9. **Net practical effect matches the brief's original pessimistic assumption.** Messaging reverted accordingly (§1).
- [x] ~~confirm whether a DAMM v2 `token_badge` for our transfer-hook mint can be self-served on devnet, or requires waiting on Meteora admin approval~~ — **RESOLVED 2026-09-23** via Meteora Discord dev support: *"you wouldn't require a token badge from the team if you are using the createConfigWithTransferHook."* Moot now given §9, but the answer itself (no badge needed) still stands as a fact about DBC's config flow.
- [x] ~~Confirm current `dynamic-bonding-curve-sdk` method name for transfer-hook-enabled pool creation/swaps~~ — **RESOLVED 2026-09-23**, confirmed live against `@meteora-ag/dynamic-bonding-curve-sdk@1.5.12` and `@meteora-ag/cp-amm-sdk@1.4.10` on devnet, not just docs. See §9 for the full working call sequence and the workarounds two of them needed.
- [ ] **New finding to resolve:** DAMM v2 has no supported path (as of the deployed devnet program + `@meteora-ag/cp-amm-sdk@1.4.10`) for enforcing a Token-2022 transfer hook on swaps. Need to ask Meteora directly whether this is a known gap, on a roadmap, or whether there's an alternate instruction/account convention we're missing — see the drafted follow-up in §9.4. This determines whether Pyle's compliance claim is DBC-phase-only (current honest framing) or whether some other mechanism could close the gap.
- [ ] Arcium MPC circuit for eligibility not yet built — needs adapting GhostID's `store_biometric`/`match_biometric` pattern.
- [ ] No tests written yet for either Anchor program beyond the default scaffolded "Is initialized!" placeholder.
- [ ] Program keypairs for `eligibility-credential` and `transfer-hook` currently live only in `target/deploy/` (gitignored via the `target` entry). If preserving devnet program IDs across machine/session resets matters, back these two keypair files up somewhere outside `target/` before it gets wiped by a clean build.

---

## 5. Repo Layout

```
Pyle/
├── Anchor.toml              # Anchor workspace config (devnet + localnet program IDs)
├── Cargo.toml                # Rust workspace root
├── rust-toolchain.toml       # pinned to 1.89.0 (managed by rustup, already installed)
├── package.json               # root JS deps for Anchor mocha tests (@coral-xyz/anchor, mocha, ts-mocha)
├── programs/
│   ├── eligibility-credential/   # Anchor program: EligibilityCredential PDA account + issuance logic
│   └── transfer-hook/            # Anchor program: Token-2022 transfer hook, checks credential on transfer
├── tests/                     # Anchor mocha/ts integration tests (one placeholder test per program so far)
├── target/                    # build artifacts (gitignored) — .so binaries, IDLs, program keypairs
├── frontend/                  # Vite + React + TS app — investor UI, wallet connect, Compliance + Market Terminal dashboard
├── backend/                   # Node/TS service — subscribes to program logs, powers live blocked-transfer feed
├── docs/                      # written docs (architecture notes, judging alignment, etc.) — empty so far
├── scripts/                   # deploy/demo helper scripts (e.g. scripted buys for the graduation demo) — empty so far
└── progress.md                # this file
```

---

## 6. Environment Check (2026-09-22, kickoff)

Verified before any installs — most tooling was already present:

| Tool | Version | Notes |
|---|---|---|
| rustc | 1.97.1 (default toolchain) | project pins 1.89.0 via `rust-toolchain.toml`, already installed via rustup, no download needed |
| cargo | 1.97.1 | |
| solana-cli | 3.1.10 (Agave) | config already pointed at devnet |
| anchor-cli | 0.32.1 | via avm |
| avm | 0.32.1 | |
| node | v20.20.0 | |
| npm | 10.8.2 | |
| yarn | 1.22.22 | yarn registry had a stale `fast-stable-stringify` lookup issue during `anchor init`; fell back to npm automatically, no action needed |
| pnpm | not installed | not currently needed, npm/yarn cover it |
| git | 2.43.0 | repo not yet initialized (see §7) |

Solana wallet: `~/.config/solana/id.json`, address `3iWQtmdwKAh2M3Ev8Beedanm5njhxqDLqDnG5uax9Cne`, already funded with ~8.96 SOL on devnet.

---

## 7. Build Log

### 2026-09-22 — Project kickoff / scaffolding

- Created top-level dirs: `programs/`, `frontend/`, `backend/`, `docs/`, `scripts/`.
- Ran `anchor init pyle-scaffold` into a temp subfolder (yarn install failed on a stale package lookup, auto-fell-back to npm successfully), then moved its contents up to the Pyle root and renamed the generated program from `pyle-scaffold`/`pyle_scaffold` to `eligibility-credential`/`eligibility_credential` throughout (Cargo.toml, lib.rs, Anchor.toml, package.json, test file). Deleted the scaffold's `app/`, `migrations/`, and its local `node_modules`/`target` — not needed given our own `frontend/`/`backend/` dirs.
- Generated a fresh program keypair for `eligibility-credential` (old one was tied to the deleted scaffold's `target/`): `HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq`.
- Added the second program via `anchor new transfer-hook` (now that `Anchor.toml` lived at the Pyle root) — program ID `F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z`. Added it to both `[programs.localnet]` and `[programs.devnet]` in `Anchor.toml` (anchor new only added the devnet entry by default).
- Set `Anchor.toml` `[provider] cluster` to `devnet` (was `localnet` default) since this project targets devnet throughout, per the brief.
- Ran `anchor build` — both programs compiled cleanly (`eligibility_credential.so`, `transfer_hook.so`, IDLs generated). Confirmed both `target/deploy/*-keypair.json` pubkeys match the `declare_id!()` values.
- Scaffolded `frontend/` with `npm create vite@latest . -- --template react-ts`, ran `npm install`, then added Solana deps: `@solana/web3.js`, `@solana/wallet-adapter-{base,react,react-ui}`, `@coral-xyz/anchor`, `@solana/spl-token`.
  - First attempt also included `@solana/wallet-adapter-wallets`, a meta-package that pulls in ~500+ transitive deps for dozens of individual wallet SDKs (WalletConnect, even unrelated-chain SDKs like Stellar). It hit an `EIDLETIMEOUT` against the npm registry on this network and failed. Dropped it — modern wallets self-register via the Wallet Standard, so `wallet-adapter-base` + `wallet-adapter-react` + `wallet-adapter-react-ui` is sufficient without hand-listing every wallet SDK. Retried without it: succeeded (520 packages, ~1 min).
- Scaffolded `backend/` by hand (no framework yet needed): `package.json` (ESM, TS, `tsx` for dev, deps `@coral-xyz/anchor`, `@solana/web3.js`, `dotenv`, `ws`), `tsconfig.json`, `src/index.ts` (minimal entrypoint — connects to devnet RPC, logs version, nothing else yet), `.env.example`.
- Extended root `.gitignore` with `dist`, `build`, `.env`, `.env.local`, `*.log` on top of the Anchor-generated defaults.
- Verified `frontend` (npm run build) and `backend` (npx tsx src/index.ts against devnet RPC) both actually work, not just "installed."
- Initialized git repo (`git init`, default branch renamed to `main`) and staged the full initial scaffold. **Not yet committed** — commits are only made on explicit request, per standing policy.
- Researched the DBC graduation/hook-revocation question (§4, was blocking) — see §8. Result: the brief's assumption was wrong; findings updated the pitch to the *stronger* claim.

### 2026-09-23 — DAMM v2 token badge question resolved

- Drafted a technical question for Meteora's Discord/Telegram dev support (the three sub-questions from §8.4) and the user posted it in Discord.
- Team reply: `createConfigWithTransferHook` needs no token badge from Meteora at all — fully self-serviceable, no admin review step. Closes the turnaround-time risk that was the last open item blocking confident scoping of Days 8–14 (hook + DBC integration). See §8.4 for the full reply and the one residual soft assumption (hook actually firing on DAMM v2 swaps post-migration is inferred, not yet empirically tested — that test itself is part of the Days 8–14 work).
- **All Day 1–2 de-risking items from the original brief are now resolved.** Clear to start on the `EligibilityCredential` program's real instructions next.
- Sent a tighter follow-up in the same Discord thread asking specifically whether the hook *fires on swaps* post-migration (not just the badge question) and for a concrete devnet example. Reply: "transfer hooks would be invoked after graduation too cause transfer hooks is something attached with tokens and not dbc or damm v2 so it should get invoked" — correct reasoning (matches our own source-code finding in §8.3: the hook lives on the mint, enforced by Token-2022 itself regardless of caller), but hedged ("should") and no concrete tx. Decision: stop asking, verify empirically instead — see below.

### 2026-09-23 (continued) — Building the empirical graduation test, and an Anchor major-version upgrade

Started building a minimal, real transfer-hook program to prove (not assume) that the hook fires post-migration. Design note: an "always reject" test hook was considered and rejected — it would also block every buy during the DBC phase, so the curve could never complete and graduation could never be triggered. Built a toggleable **wallet-gate** hook instead (`WalletGate { wallet, allowed }` PDA per recipient, admin-controlled) — a placeholder for the real `EligibilityCredential` check, structurally close enough to reuse: do the DBC-phase buys from an allowed wallet so the curve completes normally, then flip a wallet to `allowed = false` and confirm a post-migration DAMM v2 swap actually reverts on-chain.

**Anchor major-version upgrade (0.32.1 → 1.2.0), and why:** before writing the hook, checked a community reference (`solana-foundation/program-examples`, `transfer-switch` example) for the current correct Anchor + Token-2022 transfer-hook pattern — it pins `anchor-lang`/`anchor-spl` **1.0.2**, a full major version ahead of our `0.32.1` scaffold. Cross-checked against DBC's own `Cargo.toml` (the authoritative interoperability target, not a community example): DBC itself declares `anchor-lang`/`anchor-spl = "1.0.2"`, `spl-transfer-hook-interface = "2.1.0"`, `spl-tlv-account-resolution = "^0.11.1"` (with a comment noting the 0.11.1 floor is required for a bug fix in `de_escalate_account_meta`). Verified the actual on-chain migration instruction and the interface crate's public API (Seed enum, ExtraAccountMeta, ExtraAccountMetaList, TransferHookAccount, etc.) directly against source at those versions before writing any code — all confirmed present and API-compatible with the reference pattern.

Upgraded both programs to match: `avm install 1.0.2 && avm use 1.0.2`, then `anchor-lang`/`anchor-spl` version strings in both program `Cargo.toml`s. Cargo's own resolution (both DBC's and ours use plain `"1.0.2"` semver strings, which permit any `1.x`) settled on the actual latest, **1.2.0** — so re-pinned explicitly to `"1.2.0"` and switched the CLI to match (`avm install 1.2.0 && avm use 1.2.0`) rather than leave an ambiguous gap between what Cargo.toml says and what actually got compiled.

**Compile-error fixes hit along the way** (all resolved by reading actual compiler output against the real crate versions, not guessing):
1. Our `transfer-hook` package explicitly pinned `spl-discriminator = "0.4.1"`, but every other dependency in the graph (`spl-transfer-hook-interface`, `spl-tlv-account-resolution`, etc.) resolved to `0.5.2` — two incompatible versions of the same crate in one dependency graph, so the `SplDiscriminate` trait our code imported didn't match the trait the interface types actually implemented. Fixed by bumping our pin to `"0.5.2"`.
2. `CpiContext::new(...)`'s first argument changed from `AccountInfo` (older anchor-lang) to `Pubkey` in anchor-lang 1.x — matches what the community reference example already had; an initial "fix" to `.to_account_info()` (correct for the old API) had to be reverted back to `.key()`.

**Result: `anchor build` succeeds cleanly for both programs** — final combo is anchor-cli **1.0.2** with `anchor-lang`/`anchor-spl` crates resolved to **1.2.0**, `spl-transfer-hook-interface` 2.1.0, `spl-tlv-account-resolution` 0.11.4 (matching or newer than DBC's own declared dependency floor). Not the CLI/crate-version-matched setup originally intended — see the note right below for why, and what to watch for.

**CLI ended up one minor behind the crate version, deliberately, due to a flaky network, not a design choice:** tried moving the CLI to 1.2.0 to match the resolved crate version exactly (`avm install/use 1.2.0` succeeded), but every `anchor build` afterward failed 3/3 times downloading a new platform-tools release it needs (`v1.57`, ~87MB+, fails partway through with `Decode/TimedOut` each time — this WSL2 network environment struggling with larger downloads, same symptom as the earlier npm `EIDLETIMEOUT`). Reverted to `avm use 1.0.2`, which already had a working (older) platform-tools version cached from the very first successful build earlier in this session — confirmed by `.so` file timestamps predating the 1.2.0 switch. Rebuilt clean under 1.0.2; IDL for `transfer-hook` correctly lists all 4 instructions (`configure_admin`, `initialize_extra_account_metas_list`, `set_allowed`, `transfer_hook`).
**Known accepted risk:** `anchor build` now prints `WARNING: anchor-lang version(1.2.0) and the current CLI version(1.0.2) don't match... can lead to unwanted behavior`. Left as-is rather than chase the network issue further — build output has been verified correct (compiles, IDL is right) despite the warning. If anything about IDL generation, account layout, or `anchor test`/`anchor deploy` behaves oddly later, this mismatch is the first thing to revisit — either retry the `v1.57` platform-tools download on a better connection and move the CLI to 1.2.0 properly, or exact-pin both program `Cargo.toml`s to `=1.0.2` to force full alignment the other direction.

**Design decision — gate the recipient, not the sender:** the community reference example gates the *sender's* wallet (using the source-account-owner, which Token-2022's `Execute` instruction always passes as a standalone account). Our real requirement is the opposite — gate the *buyer* (destination/recipient), per the brief's own instruction spec in §2. Token-2022 doesn't pass the destination owner as a standalone account, so the `WalletGate` PDA is instead derived from the destination token account's `owner` field read directly out of account data — `Seed::AccountData { account_index: 2, data_index: 32, length: 32 }` for the off-chain/generic resolver (any caller, including DAMM v2, can compute this without knowing anything about our program), and the typed `InterfaceAccount<'info, TokenAccount>`'s `.owner` field on-chain for our own constraint. Confirmed byte offset 32 against the current `spl-token-2022-interface` source (base SPL Token account layout: mint 0..32, owner 32..64, stable across Token-2022's extension-carrying accounts).

**Not yet done:** deploying this hook to devnet, minting a test Token-2022 mint with it attached, running the DBC-side integration (`createConfigWithTransferHook`, `createPoolWithTransferHook`), forcing graduation, and the actual on-chain swap-revert test. That's the next concrete step.

### 2026-09-23 (continued further) — Deployed, integrated, and ran the graduation test to a definitive result

- Deployed both programs to devnet. `eligibility_credential` went cleanly first try; `transfer_hook` (214KB) failed three times in a row with "Max retries exceeded" / RPC timeouts on this flaky network. Diagnosed that repeated failed deploys were leaving stranded buffer accounts locking up devnet SOL (`solana program show --buffers` showed ~20 SOL tied up across 9 buffers) — closed them all (`solana program close --buffers --bypass-warning`) to reclaim funds, then deployed successfully via direct `solana program deploy` with `--with-compute-unit-price 1000 --max-sign-attempts 60`.
- Built `scripts/graduation-test/` (own `package.json`; deps: `@meteora-ag/dynamic-bonding-curve-sdk`, `@meteora-ag/cp-amm-sdk`, `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `bn.js`) and wrote `index.ts` implementing the full flow described in §9.
- Hit and fixed 6 real bugs end to end (SDK placeholder-based extra-account resolution, ExactIn-vs-PartialFill curve capacity, migration response shape, `CpAmm.swap()` return type, `referralTokenAccount` typing, devnet SOL management) — see §9.2 for the full list with root causes. Added a `RESUME_CONFIG`/`RESUME_BASE_MINT` env-var resume mode to the script so re-running after a network hiccup doesn't require recreating the whole pool from scratch — this repo's network has been consistently flaky all session (npm registry timeouts, platform-tools downloads, RPC timeouts, DNS blips), so treat "retry with resume" as the standard move here, not a one-off.
- **Got a definitive, on-chain answer: DAMM v2 does not invoke the Token-2022 transfer hook on swaps at all.** Full writeup, transaction signatures, and account-list evidence in §9. This reverses §8.3's "upgrade the claim" conclusion — §1's messaging table and §4's risk list are updated accordingly.
- Devnet SOL is now low (payer wallet down to ~0.09 SOL after this session's deploys, buffer-account churn, and repeated pool creation during debugging) — will need a top-up (airdrop faucet was rate-limited most of this session; try again next time, or use an alternate faucet) before further on-chain testing.

**Next up:** send the factual follow-up to Meteora's Discord (drafted in §9.4, not yet posted — pending the user's go-ahead), then decide whether to keep `set_allowed`/`WalletGate` as the interim hook design for the demo (DBC-phase-only enforcement, honestly framed) or investigate further before starting the real `EligibilityCredential` + Arcium work.

### 2026-09-25 — §9's conclusion corrected: it's DBC, not DAMM v2

The §9.4 follow-up (blaming DAMM v2's swap instruction) was sent. Meteora's Discord team pushed back correctly: after confirming the test mint was ours, they flagged that its `transferHook` extension showed `authority`/`programId` both `NULL` on-chain — meaning it never had an active hook by the time anyone looked, which undercut the whole premise of blaming DAMM v2 specifically.

Didn't take the correction at face value or dismiss it — verified directly, and it fully panned out, but pointed at a different root cause than either the DAMM v2 theory or the original hook-revoked-at-migration theory: **DBC itself revokes the hook's authority and programId the instant the bonding curve completes**, inside the same swap transaction, via Token-2022's `TransferHookInstruction::Update` + `SetAuthority`, both invoked by DBC's own program — well before `migrateToDammV2` is ever called. Full investigation, evidence, and reasoning in §10 (supersedes §9.4's conclusion; §9.1–9.3's factual observations — the empirical test setup, the bugs found, the "DAMM v2's swap account list has no hook references" observation — all still stand, just needed the right explanation attached).

Net effect on the pitch/messaging is unchanged from §9 — eligibility enforcement still doesn't survive past curve completion, so §1's messaging stays as-is. What changed is the accuracy of *why*, which matters for the corrected Discord follow-up (§10.3) and for anyone else building a compliance hook on DBC (the enforcement window ends at curve completion, not at migration execution — worth knowing precisely).

---

## 8. Research: DBC Transfer-Hook Behavior at Graduation (2026-09-22)

**Question:** does Meteora's DBC program revoke/strip a Token-2022 transfer hook from the base mint when a pool graduates/migrates to DAMM v2, as the original brief assumed?

**Answer: No — the transfer hook persists through migration.** The brief's assumption was incorrect. Sources checked directly (not from memory):

### 8.1 What was checked
- `docs.meteora.ag` DBC developer guide pages (several linked sub-pages 404'd — docs site appears to have been restructured since indexing; the top-level pages that did load had no explicit statement either way).
- **DBC on-chain program source**, `github.com/MeteoraAg/dynamic-bonding-curve`, specifically `programs/dynamic-bonding-curve/src/instructions/migration/dynamic_amm_v2/migrate_damm_v2_initialize_pool.rs` — the actual instruction that creates the DAMM v2 pool at graduation. Read in full: it CPIs into `damm_v2::cpi::initialize_pool` (or `initialize_pool_with_dynamic_config`), passing `base_mint` and `quote_mint` **as-is**. The only Token-2022 extension logic present is a check that the *quote* mint has zero transfer fees. There is no code touching `TransferHook`, no hook-authority update, no revocation of any kind on the base mint.
- **DBC TypeScript SDK docs** (`docs.md` in `github.com/MeteoraAg/dynamic-bonding-curve-sdk`) — confirmed there is exactly **one** `migrateToDammV2` function, used identically for every pool regardless of whether it's a transfer-hook pool. No separate "strip the hook" variant exists, and its docs/notes make no mention of hook removal.
- **DAMM v2 program README** (`github.com/MeteoraAg/damm-v2`) — confirms Token-2022 support explicitly: *"All token2022 with metadata pointer and transfer fee extensions are supported permissionlessly. Token mints with other extensions can be whitelisted by Meteora's admin"* via a `create_token_badge` instruction.

### 8.2 Confirmed current SDK surface (do not use older/remembered names)
From `dynamic-bonding-curve-sdk` `docs.md`, the transfer-hook-specific flow is a deliberate, first-class parallel API, not a workaround:
- `createConfigWithTransferHook` — transfer-hook variant of `createConfig`, stores the hook program in the config account.
- `createConfigAndPoolWithTransferHook`, `createConfigAndPoolWithFirstBuyWithTransferHook`
- `createPoolWithTransferHook`, `createPoolWithFirstBuyWithTransferHook`, `createPoolWithPartnerAndCreatorFirstBuyWithTransferHook`
- `swap2WithTransferHook` — swaps on a transfer-hook pool; SDK auto-derives and appends the transfer-hook remaining accounts for the base mint.
- `migrateToDammV2` — the single, generic migration function (params: `payer`, `pool`, `dammConfig`; one remaining account for the DAMM V2 config). No transfer-hook-specific variant, because none is needed — the mint carries its extensions with it.

### 8.3 SUPERSEDED 2026-09-23 — see §9 for what actually happens on-chain

This section originally argued (from source reading alone) that the hook should keep firing after graduation, reasoning that (1) the DBC migration instruction never touches the TransferHook extension, (2) the base mint is the same account before and after migration, and (3) SPL Token-2022's `transfer_checked` "always" invokes a mint's hook when one is set.

**Point 3 turned out to be wrong, or at least incomplete.** §9 documents a real devnet test where a DAMM v2 swap succeeded on a hook-enabled mint with *zero* hook-related accounts (hook program, ExtraAccountMetaList, our credential PDA) anywhere in the transaction. Whatever Token-2022's actual enforcement mechanism is, it evidently does not stop a caller from completing `transfer_checked` without supplying those accounts — the burden is apparently on the *calling program* to know to include them, and DAMM v2 doesn't. Points 1 and 2 are still accurate as statements about the DBC migration instruction itself; the conclusion drawn from them was the part that didn't hold up. Lesson: source-reading gets you a hypothesis, not a result — this is exactly why the empirical test in §9 was worth building instead of shipping on the reasoning alone.

### 8.4 Token badge question — RESOLVED 2026-09-23

Asked directly in Meteora's Discord dev support channel (question drafted in-session, posted by the user). Reply from a Meteora team member:

> "hi, you wouldn't require a token badge from the team if you are using the createConfigWithTransferHook"

**This confirms:** no `create_token_badge` step, no manual admin review, no Google Form/Discord ticket wait — the `createConfigWithTransferHook` flow is fully self-serviceable end-to-end, including through migration. The turnaround-time risk flagged above is closed.

**What this does *not* explicitly confirm:** the reply addresses the badge requirement, not the runtime question of whether the hook actually gets invoked on every swap once the pool lives in DAMM v2. Treating "no badge needed" as implying "the hook is fully functional post-migration" is a reasonable inference (Meteora wouldn't design a badge-free path that silently breaks the extension), not a direct statement of fact. Low-risk residual assumption — the real proof will be the Days 8–14 integration test: create a transfer-hook DBC pool, graduate it, and observe on-chain whether a swap from a non-credentialed wallet actually gets rejected by the hook inside the DAMM v2 pool. If that test ever contradicts this assumption, revisit the messaging claim in §1/§8.3 immediately.

**Follow-up sent 2026-09-23, reply received:** asked a tighter follow-up in the same thread — does the hook actually fire on DAMM v2 swaps, does a rejection revert the transaction, and is there a live example. Reply: *"transfer hooks would be invoked after graduation too cause transfer hooks is something attached with tokens and not dbc or damm v2 so it should get invoked."* Correct reasoning in principle (matches §8.3's original argument), hedged ("should"), no concrete example given. Decision at the time: don't keep asking, build the real test instead. §9 is that test, and it contradicts this answer — see §9.4 for the loop back to Meteora with hard evidence instead of more questions.

---

## 9. Empirical Test: Does the Hook Actually Fire on a DAMM v2 Swap? (2026-09-23)

**Question:** settle, on real devnet transactions (not source reading, not a Discord opinion), whether a Token-2022 transfer hook attached to a DBC pool's base mint is actually invoked when that pool's swaps happen inside DAMM v2 after graduation.

**Answer: No. Proven on-chain, not inferred.** A DAMM v2 swap from a wallet the hook program had explicitly marked *not allowed* succeeded anyway — and inspecting the transaction's raw account list shows the hook program, the `ExtraAccountMetaList` account, and our credential PDA are **not present anywhere in the transaction**. DAMM v2's swap instruction doesn't reference the hook at all.

### 9.1 What was built

- A second, real instruction added to `programs/transfer-hook`: a toggleable `WalletGate { wallet, allowed }` PDA per recipient (admin-controlled via `set_allowed`), gating the **destination** (buyer) rather than the sender — see the design note logged 2026-09-23 in the Build Log below for why, and how the `ExtraAccountMetaList` seeds were built (`Seed::Literal("gate")` + `Seed::AccountData` reading the destination token account's owner field at byte offset 32).
- `scripts/graduation-test/index.ts` — a standalone TS script (own `package.json`, not part of `frontend`/`backend`) that:
  1. Configures our hook program's admin and allows a test buyer wallet.
  2. Creates a real DBC config + pool via `createConfigWithTransferHook` / `createPoolWithTransferHook` (`@meteora-ag/dynamic-bonding-curve-sdk@1.5.12`), Token-2022 base mint, transfer hook = our deployed `transfer-hook` program.
  3. Registers the hook's `ExtraAccountMetaList` for the new mint.
  4. Buys from the DBC pool in chunks (`SwapMode.PartialFill`, see §9.2) until the curve completes.
  5. Migrates to DAMM v2 via `migrateToDammV2`.
  6. Attempts a DAMM v2 swap (`@meteora-ag/cp-amm-sdk@1.4.10`'s `CpAmm.swap`) with the buyer **allowed**, then flips `set_allowed(buyer, false)` and attempts an identical swap again.

### 9.2 Real bugs hit and fixed along the way (all confirmed against live devnet transactions, not guessed)

1. **DBC's own extra-account resolver can't handle recipient-dependent seeds.** `swap2WithTransferHook`'s `getRemainingAccountsForTransferHook` discovers which extra accounts a mint's hook needs by calling `createTransferCheckedWithTransferHookInstruction` with `PublicKey.default` (all-zero) as a placeholder for source/destination/owner — fine for hooks with static extra accounts, but our `Seed::AccountData` read (destination token account, offset 32) tries to read account data from `PublicKey.default` and throws `TokenTransferHookInvalidSeed` before a transaction is even built. Root-caused by decoding our on-chain `ExtraAccountMetaList` bytes by hand (confirmed our packing was correct — `01 04 67 61 74 65 04 02 20 20 00...` = `Literal("gate")` + `AccountData{index:2,offset:32,len:32}`, exactly as intended) and then reading the SDK's actual bundled `@solana/spl-token` source to find where the placeholder gets used. **Fix:** monkeypatched `dbcClient.pool.getRemainingAccountsForTransferHook` (a `protected` TS method, unenforced at runtime) to return the correctly-resolved account for our real buyer instead, replicating the exact account ordering `addExtraAccountMetasForExecute` produces (`[...resolvedExtras, hookProgramId, validateStatePubkey]`).
   - **This is a real, general limitation of the current DBC SDK**, not specific to us: any transfer hook whose extra accounts depend on the actual transfer participants (recipient- or sender-gated hooks — i.e. any real compliance/whitelist hook) cannot use `swap2WithTransferHook`'s automatic account resolution as-is. Worth flagging to Meteora separately from the DAMM v2 question (§9.4).
2. **`SwapMode.ExactIn` can't approach the curve's completion threshold.** DBC's on-chain check is `require!(amount_left == 0, InsufficientLiquidity)` (`virtual_pool.rs:596`) — an ExactIn swap that would require crossing the migration price ceiling fails outright rather than partially filling; there's no automatic capping. **Fix:** switched buy-loop swaps to `SwapMode.PartialFill`, which fills as much as the curve can currently absorb — turns a fiddly "compute the exact remaining capacity" problem into "just ask for a generous flat amount repeatedly, poll `quoteReserve` between buys."
3. **`migrateToDammV2` returns `{ transaction, firstPositionNftKeypair, secondPositionNftKeypair }`**, not a bare `Transaction` — needs those two extra keypairs as co-signers (position NFT mints created in the same tx).
4. **`CpAmm.swap()` returns `Promise<Transaction>` directly** (the `TxBuilder` type alias), not a builder object with a `.transaction()` method — despite the docs' `SwapParams` example not making this obvious.
5. **`SwapParams.referralTokenAccount` is typed `PublicKey | null`, not optional** — omitting it entirely throws an Anchor "account not provided" error at the client, even though prose docs call it optional.
6. **Devnet SOL discipline:** repeated failed attempts on a flaky network (see below) stranded SOL on throwaway generated buyer keypairs and drained ~24 SOL of devnet funds before this was fixed. Switched the test script to persist and reuse one buyer keypair (`scripts/graduation-test/buyer-keypair.json`, gitignored) and only top it up when its balance is actually low, instead of generating + funding a fresh wallet every run.

None of these were guessed — each was root-caused by reading the actual installed package source (`node_modules/@meteora-ag/.../dist/index.js` and `.d.ts`, and even `@solana/spl-token`'s bundled transfer-hook seed decoder) rather than trusting docs or memory, consistent with this project's standing rule.

### 9.3 The decisive transaction

Devnet DAMM v2 pool: `HXxpHijRUp3ggjMNyGmkXpb7hPdUEm7XxdmTTcPZhVnK` (graduated from DBC pool `CkXoKBqsFbuUidis2kapEWMJfHVnsMo5oLzCWYnHTdKS`, base mint `4AqXbEZjTjvtoR7PAzvQqTp67iDfYj3ZKWJREjJ7WhPM`, transfer hook program `F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z`).

1. `set_allowed(buyer, true)` → DAMM v2 swap tx `5ovZYuBU3dBwgeppWDBSepVSUYvTpiujied1HH6RLBUE9SEk6NBfGVU6L4oCn8PgHXvMPNh9nM98Jj1pf7WgVc3t` — succeeded.
2. `set_allowed(buyer, false)` (confirmed on-chain before the next step) → DAMM v2 swap tx `342Di9VPNk9Ui93kMANdeozHpM5MNKAp5seKrnMBZxduhmUERsfJrc5KtKkJoqKibbU2LvfBSPsxbvLMj3MJHMRq` — **also succeeded.** Buyer's base-token balance confirmed via `spl-token accounts` afterward (752,450,416.985893 tokens held) — a real transfer happened, not a degenerate zero-amount no-op.

`solana confirm <sig> -v` on transaction 2 lists every account touched. The actual swap CPI (Instruction 4, program `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` = DAMM v2) uses 12 accounts: pool authority, pool, input/output token accounts, vaults, mints, quote mint, and program IDs. **The transfer-hook program (`F9p71yDg...`), the `ExtraAccountMetaList` PDA, and our `WalletGate` PDA appear nowhere in the transaction.** DAMM v2's swap doesn't just fail to *enforce* the hook — it never references it at all.

### 9.4 SUPERSEDED 2026-09-25 — §9.3's account-list observation was correct, but the diagnosis was wrong. See §10 for the real, fully-verified mechanism: DBC itself strips the hook at curve completion, before DAMM v2 is ever involved. The old text below is kept for the record of how the investigation evolved, not as current guidance.

~~- **The brief's original "verify first" concern turns out to be practically correct, though the mechanism is different from what it guessed.** It's not that Meteora revokes the hook at migration (§8 already disproved that). It's that DAMM v2's swap instruction, as currently implemented, simply never invokes any transfer hook, full stop.~~ — wrong conclusion; see §10.

~~- Follow-up sent to Meteora Discord blaming `p_transfer_from_pool`/`p_transfer_from_user` in DAMM v2's `p_helper.rs`~~ — this observation about DAMM v2's account list was accurate but misattributed the cause; DAMM v2 never gets a mint with an active hook to invoke in the first place, because DBC already stripped it. A corrected follow-up is in §10.3.

---

## 10. The Real Mechanism, Fully Verified (2026-09-25)

**What actually happens:** DBC's own on-chain program revokes the Token-2022 transfer hook's `authority` and `programId` (sets both to the default/zero pubkey) **the instant the bonding curve completes** — as part of the very same swap transaction that pushes `quoteReserve` over `migrationQuoteThreshold`. This happens during the DBC phase, in the completing buy itself, *before* migration to DAMM v2 is even called. By the time a pool reaches DAMM v2, the mint genuinely has no transfer hook configured — DAMM v2 isn't failing to invoke a hook, there is nothing left to invoke. §9's conclusion ("DAMM v2 doesn't invoke hooks") was an observation of a true symptom with the wrong cause attached.

### 10.1 How this was found

A Meteora team member (Discord, "Shubh") asked to confirm ownership of the test mint, then flagged: *"onchain it shows that there is no program Id attached to it so possible that the hook program is not invoked"* — with a Solscan link showing the mint's `transferHook` extension with `authority: NULL, programId: NULL`. This directly contradicted what we'd told them (that the hook fires correctly during DBC). Rather than accept or dismiss the correction, verified it directly:

1. **Confirmed independently** (not just trusting the Solscan screenshot): fetched the mint via `@solana/spl-token`'s `getMint`/`getTransferHook` — same result, `authority` and `programId` both `11111111111111111111111111111111` (System Program / default pubkey, i.e. unset).
2. **Checked an earlier test mint** from a pool that had successful DBC buys but never reached migration (curve stalled at 855M/1000M lamports before we understood the `PartialFill` fix) — its hook was still correctly set to our program. This showed the clearing wasn't happening at pool-creation time or merely "after some buys," and pointed at either curve-completion or migration as the trigger.
3. **Built a fresh, minimal, single-mint isolation test** (`scripts/graduation-test/` throwaway helper scripts, since deleted — logic folded into this writeup) that created a new pool with a *low* threshold (0.05 SOL, so one buy could complete it) and checked the mint's hook state at each step:
   - Right after `createPoolWithTransferHook`: hook correctly set (`programId: F9p71yDg...`).
   - Right after a single curve-completing buy, *before calling migrateToDammV2*: hook already cleared (`authority`/`programId` both default).
   - After `migrateToDammV2`: still cleared (no change — migration had nothing left to touch).
4. **Confirmed the exact mechanism** by reading that buy transaction's full log: inside the same `Swap2WithTransferHook` instruction, right after `TransferChecked` → CPI into our hook (`TransferHook`, succeeded), the DBC program itself calls Token-2022's `TransferHookInstruction::Update` (clears `programId`) followed by `SetAuthority` (clears `authority`) — both against the base mint, both invoked by the DBC program (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`), atomically within the completing swap.

Along the way this also **positively confirmed the hook genuinely works via real Token-2022 enforcement during the DBC phase**: the first attempt at the completing buy hit a real on-chain rejection (`AnchorError ... NotAllowed`) because the test buyer's `WalletGate` had been left `allowed = false` from the end of a previous test run — i.e. Token-2022's native `TransferChecked` → hook CPI path was firing for real, not being bypassed by some DBC-specific shortcut as briefly hypothesized mid-investigation.

### 10.2 Why this makes sense, and what it means

- This is almost certainly *deliberate* Meteora design, not a bug: DAMM v2 only accepts non-permissionless Token-2022 extensions (transfer hook included) via a `token_badge` (§8.4). By stripping the hook at curve completion, DBC makes every `createConfigWithTransferHook` pool arrive at migration already "permissionless" from DAMM v2's point of view — exactly matching what the Discord team told us earlier ("you wouldn't require a token badge... if you're using createConfigWithTransferHook") and exactly matching the pattern in DAMM v2's own test suite (`permissionLessTransferHook.test.ts`'s `revokeAuthorityAndProgramIdTransferHook` helper, which we found in §8/§9 research but, at the time, assumed was just a test-writer's manual step rather than something DBC does automatically in production).
- **Net effect on the pitch is the same as §9's conclusion, for a different reason:** eligibility enforcement does not survive past curve completion. The messaging in §1 ("eligibility is enforced during the DBC phase; the asset trades openly once graduated") stays correct and doesn't need to change again. What changes is *why*, and that matters for talking to Meteora credibly and for anyone else building a compliance hook on DBC: **the hook stops being enforceable from the moment the curve completes, not from the moment migration executes** — there may be a window between "curve technically complete" and "someone actually calls migrateToDammV2" (could be seconds, could be longer if using the manual migrator) where the mint has *no* transfer hook at all, on a pool that's still nominally "DBC." Worth checking whether swaps are even possible in that window (the SDK notes migration requires the pool to already be complete, so trading may just be halted until migration lands) — not yet verified, flagged as an open question.
- This also resolves the "DAMM v2 SDK limitation" tangent from §9.2 point 1 as a real but now lower-priority finding: `getRemainingAccountsForTransferHook`'s placeholder-based resolution is still a genuine rough edge for anyone building a *sender/recipient-gated* hook on DBC (it'll crash before this revocation behavior even becomes relevant), worth keeping in the Discord follow-up as a separate, smaller item.

### 10.3 Corrected follow-up for Meteora Discord

The reply already sent (§9.4, now marked superseded) told the team DAMM v2 doesn't invoke hooks and pointed at `p_helper.rs`. That symptom description was accurate but the framing was wrong — worth a clear correction rather than leaving it standing:

> Correction to what I said above — dug further and it's not a DAMM v2 issue. DBC itself revokes the transfer hook's `authority` and `programId` (Token-2022 `TransferHookInstruction::Update` + `SetAuthority`, both invoked by the DBC program) inside the very swap that completes the curve — before migration is even called. Confirmed by checking the mint's hook state immediately after a curve-completing buy vs. immediately after `createPoolWithTransferHook`: already cleared by the time the buy transaction lands. So DAMM v2 never has a hook to invoke — makes sense given DAMM v2 needs a `token_badge` for non-permissionless extensions and this avoids that entirely for `createConfigWithTransferHook` pools. Assuming this is deliberate design (matches the `revokeAuthorityAndProgramIdTransferHook` pattern in your own `permissionLessTransferHook.test.ts`) — is that right, and is it documented anywhere? Would've saved some debugging time to know this going in, might be worth a line in the transfer-hook docs for the next person who tries this.
>
> Separate, smaller thing: `swap2WithTransferHook`'s automatic extra-account resolution (`getRemainingAccountsForTransferHook`) resolves against `PublicKey.default` placeholders for source/destination/owner, so it can't handle a hook whose extra accounts depend on the real transfer participants (e.g. a recipient-gated allowlist/credential PDA) — throws `TokenTransferHookInvalidSeed` before a transaction is even built. Worked around it by monkeypatching the resolver client-side; a real fix would need the SDK to accept caller-supplied resolved accounts for `swap2WithTransferHook` the way the first-buy variants already do (`transferHookAccounts` param).

### 10.4 Updated guidance for the rest of the build

- **Don't build anything assuming enforcement past curve completion.** The `EligibilityCredential` + Arcium work (Days 3–14 in the original brief) is still exactly right to build — it gates the DBC phase, which is the phase that matters (initial distribution to unverified buyers is the actual compliance risk; secondary trading of an already-graduated, already-liquid asset is a different, better-understood regulatory posture, same as the brief's fallback framing already said).
- **Demo script stays accurate as originally written** (§1) — Wallet A/B/C buy during the DBC phase, graduation happens live, and the narration at graduation should now say *why* trading opens up (hook genuinely gone, not just "unenforced") with the confidence of something empirically verified three times over, not a hedge.
- **Do verify the "gap between curve-complete and migration" window** mentioned in §10.2 before finalizing the demo script's graduation moment — if trades are possible in that window, they'd be hook-free DBC-phase trades, worth knowing about either way.
