# Pyle

**Compliance that's wired directly into a Meteora token's launch lifecycle — the same eligibility policy follows the asset from its bonding curve through graduation into DAMM v2 liquidity, without the launchpad ever holding investor financial data.**

Built for Meteora's Dynamic Bonding Curve (DBC) track at Colosseum's Stocklana hackathon.

πύλη (Pyle) — Greek for "gate": the transfer hook is the gate that checks eligibility before letting a trade through.

**Live demo:** [frontend-indol-rho-65.vercel.app](https://frontend-indol-rho-65.vercel.app) — real devnet backend at [pyle-backend-production.up.railway.app](https://pyle-backend-production.up.railway.app).

## The problem

Tokenized-stock launches on Meteora DBC legally need to restrict buyers to eligible (accredited) investors. The standard fix is a centralized KYC database — a privacy risk and a single point of failure. Pyle enforces eligibility on the asset itself, automatically, without exposing who anyone is or what their income/net worth actually are.

Privacy-preserving accredited-investor verification already exists as a category elsewhere. Pyle's claim is narrower and specific to Meteora: *investor eligibility is integrated directly into DBC's launch-to-graduation lifecycle*, not offered as a standalone identity credential bolted on afterward. Nothing else touches DBC's graduation mechanics the way this does.

## How it works

Three pieces, all real, all on-chain:

1. **Private eligibility check** (`programs/eligibility-mpc` + `arcium-mpc/`) — an investor's income and net worth are encrypted on their device and jointly evaluated by real Arcium MPC nodes on devnet cluster 456. No single node ever sees the raw numbers; only the boolean result (`income > $200k OR net_worth > $1M`) is revealed on-chain.
2. **A structured on-chain credential** (`programs/eligibility-credential`) — an eligible result lets the issuer write a real `EligibilityCredential` account for that wallet (policy, issuer, status, issued/expiry timestamps), not just a flag.
3. **Enforcement on every transfer** (`programs/transfer-hook`) — a Token-2022 transfer hook on the asset's mint reads that credential on every buy. Missing, expired, or revoked credentials revert the entire transaction atomically — the buyer's SOL never moves and no tokens change hands.

All three are wired into a real Meteora DBC pool: buys are real DBC swaps, and graduation (the curve reaching its threshold) triggers Meteora's own real on-chain hook revocation and a real migration into DAMM v2 liquidity.

## What's actually real here

Said explicitly because it matters for evaluation: **nothing in this demo is UI-mocked.** Every number the dashboard shows comes from a live backend watching real devnet transactions.

| Piece | Real? |
|---|---|
| MPC eligibility computation | Real — actual Arcium cluster computation, not a client-side stand-in |
| On-chain credential issuance/revocation | Real `issue_credential`/`revoke_credential` instructions |
| Transfer hook rejection | Real atomic transaction reverts, with distinct error codes for "no credential," "expired," and "revoked" |
| DBC buys | Real `swap2WithTransferHook` calls against a live pool |
| Graduation | Real: the curve is pushed to its threshold with real buys, Meteora's DBC program really revokes the transfer hook in that completing swap, and a real `migrateToDammV2` call creates a real DAMM v2 pool |
| Live feed / dashboard | Real backend service subscribing to program logs over a WebSocket — not polling a mock |

The one deliberately simplified piece: the terminal's displayed ACME price is "SOL raised toward the curve threshold," not a reconstruction of DBC's exact bonding-curve spot price formula — a display simplification, not a correctness gap in the compliance mechanism itself.

## Demo script

1. **Wallet A** — already holds a valid credential. Buys ACME on the curve. Succeeds, shown live in the gate feed with a real transaction signature.
2. **Wallet B** — no credential. Attempts to buy. Fails atomically; the feed logs the real rejection reason (`AccountNotInitialized`, surfaced as "No credential on file").
3. **Wallet C** — holds a credential with `expires_at` in the past. Attempts to buy. Fails with a distinct reason (`CredentialExpired`) — proving the expiry check does real work, not just a boolean gate.
4. **Verify tab** — enter test income/net-worth figures for any wallet, run a real MPC check. If eligible, a real credential is issued automatically by the issuer bridge.
5. **Run graduation** — pushes the curve to its threshold with real buys, migrates to a real DAMM v2 pool live on screen, and narrates honestly: eligibility enforcement is real through the DBC phase; Meteora's own DBC program revokes the transfer hook in the same transaction that completes the curve (by design — see [Known limitations](#known-limitations)), so the asset trades openly once graduated, the same way a security restricted at issuance becomes freely tradable later.

## Architecture

```
                    ┌─────────────────────┐
  investor's        │   eligibility-mpc    │  Arcium MPC cluster 456
  income/net worth ─▶  (encrypted inputs)  │─▶ eligible: bool (revealed)
  (encrypted on       └─────────────────────┘
   their device)                │
                                 ▼ if eligible
                      ┌─────────────────────┐
                      │ eligibility-credential│  PDA: ["eligibility", wallet, policy_id]
                      │  issue_credential()   │
                      └─────────────────────┘
                                 │
                                 ▼ checked on every transfer
                      ┌─────────────────────┐        ┌──────────────┐
  buyer ──── buy ────▶│    transfer-hook     │◀──────▶│ Meteora DBC  │
                      │  Execute: assert      │        │ pool + curve │
                      │  status==Valid &&      │        └──────────────┘
                      │  now < expires_at      │               │
                      └─────────────────────┘               ▼ at graduation
                                 │                   Meteora revokes the hook,
                                 ▼                   migrates to DAMM v2 (real)
                        pass → transfer completes
                        fail → whole tx reverts

              ┌───────────────────────────────────────┐
              │     backend/ (Node + WS)               │
              │  watches all of the above live on-chain │
              │  → frontend/ terminal dashboard          │
              └───────────────────────────────────────┘
```

## Tech stack

- **On-chain:** Anchor (Rust), Solana devnet, Token-2022 transfer hooks
- **Privacy:** Arcium MPC (`@arcium-hq/client`, `arcium-anchor`) — isolated workspace (`arcium-mpc/`) due to an upstream dependency pin
- **DEX integration:** `@meteora-ag/dynamic-bonding-curve-sdk`, `@meteora-ag/cp-amm-sdk` (DAMM v2)
- **Backend:** Node + TypeScript, plain `http`/`ws` (no framework) — watches program logs and DBC pool state, exposes a small HTTP API + WebSocket feed
- **Frontend:** Vite + React + TypeScript

## Repo layout

```
Pyle/
├── programs/
│   ├── eligibility-credential/  # on-chain credential: issue/revoke, PDA per wallet+policy
│   ├── eligibility-mpc/         # Arcium MXE program: queues/receives the MPC computation
│   └── transfer-hook/           # Token-2022 transfer hook: checks the credential on every transfer
├── arcium-mpc/                  # isolated workspace for the MPC circuit + its TS client
├── backend/                     # live dashboard service (watchers + HTTP/WS API)
├── frontend/                    # the terminal dashboard (landing / terminal / issuer views)
└── scripts/
    ├── eligibility-test/        # wallet A/B/C setup, demo DBC pool + mint setup/verification
    ├── graduation-test/         # proved out real graduation mechanics
    └── issuer-bridge/           # connects MPC results to real credential issuance
```

## Running it locally

```bash
# One-time: build and deploy the programs (devnet), then set up demo state
anchor build && anchor deploy
cd scripts/eligibility-test && npm install
npx tsx index.ts                  # wallets A/B/C + their credentials
npx tsx setup-demo-dbc-pool.ts    # the persistent DBC pool the terminal buys against

# Backend (live feed + API)
cd backend && npm install && npm run dev   # :8787

# Frontend
cd frontend && npm install && npm run dev  # :5173
```

The backend defaults to the pool `setup-demo-dbc-pool.ts` creates (via `demo-dbc-pool.json`) and devnet's public RPC; see `backend/.env.example` for overrides.

## Testing

Every test runs against live devnet — the same real programs, the same real Arcium cluster the demo uses — using a throwaway wallet generated per run, never the demo's own wallet A/B/C or DBC pool, so running the suite never disturbs the demo state.

```bash
npm test                                     # credential issuance/revocation + hook enforcement
cd arcium-mpc && npm test                    # real MPC round trip (two cases, ~30-90s)
```

## Deployed programs (devnet)

| Program | Address |
|---|---|
| `eligibility-credential` | `HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq` |
| `transfer-hook` | `F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z` |
| `eligibility-mpc` | `4Fdcz9uK5SKnH5X5XAfwfH1bD1oefpz3LLLRbaN7zTbh` |

## Known limitations

- **Eligibility enforcement is DBC-phase-only, by Meteora's own design.** Confirmed directly with the Meteora team: DBC revokes the transfer hook's authority and program ID in the very swap that completes the curve, before migration is even called, so a DAMM v2 pool never has a hook to invoke — "there is no action needed from our end and you cant extend the transfer hook into DAMM v2 pool." This isn't a bug in Pyle; it's the same posture as a real security restricted at issuance and freely tradable afterward, and the dashboard narrates it honestly rather than claiming otherwise.
- Verification inputs (income/net worth) are simulated test data entered directly in the UI. In production these would come from a real provider (e.g. Civic); Pyle never receives the underlying figures either way — only the MPC-revealed boolean.
- Demo wallets A/B/C are prepared backend-held keypairs rather than a connected browser wallet, so the credential story is visible without requiring a wallet extension during judging.
