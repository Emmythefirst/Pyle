import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Real devnet, against the actual deployed program -- not a fresh localnet
// instance (this project's whole verification philosophy, see progress.md).
// Uses a throwaway wallet generated per run, never scripts/eligibility-test's
// wallet A/B/C, so this never touches the live demo's credential state.

const ELIGIBILITY_CREDENTIAL_PROGRAM_ID = new PublicKey(
  "HeopPJru1XZ7AHXDack1mtLSLKFejvRyLsrJZtJoz1bq",
);
const POLICY_US_ACCREDITED = Buffer.concat([
  Buffer.from("US_ACCREDITED", "ascii"),
  Buffer.alloc(32 - "US_ACCREDITED".length),
]);

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}

describe("eligibility-credential (real devnet)", () => {
  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const provider = new AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const idl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../target/idl/eligibility_credential.json"), "utf-8"),
  );
  const program = new Program(idl as Idl, provider) as never as {
    methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: () => Promise<string> } }>;
    account: {
      eligibilityCredential: {
        fetch: (addr: PublicKey) => Promise<{
          wallet: PublicKey;
          issuer: PublicKey;
          status: Record<string, unknown>;
          expiresAt: BN;
        }>;
      };
    };
  };

  const testWallet = Keypair.generate();
  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  );

  before(async function () {
    this.timeout(60_000);
    // configure_issuer only needs to run once ever -- scripts/eligibility-test
    // already did this in the normal course of setting up the live demo, so
    // this is a safety net for a from-scratch environment, not the common path.
    const existing = await connection.getAccountInfo(issuerConfigPda);
    if (!existing) {
      await program.methods
        .configureIssuer()
        .accounts({
          issuer: payer.publicKey,
          newIssuer: payer.publicKey,
          issuerConfig: issuerConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  it("a wallet with no credential has no account to fetch", async () => {
    const neverIssued = Keypair.generate();
    let threw = false;
    try {
      await program.account.eligibilityCredential.fetch(credentialPda(neverIssued.publicKey));
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/Account does not exist/i);
    }
    expect(threw).to.equal(true);
  });

  it("issues a credential with exactly the fields requested", async function () {
    this.timeout(30_000);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(expiresAt))
      .accounts({
        issuer: payer.publicKey,
        wallet: testWallet.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(testWallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.eligibilityCredential.fetch(credentialPda(testWallet.publicKey));
    expect(account.wallet.toBase58()).to.equal(testWallet.publicKey.toBase58());
    expect(account.issuer.toBase58()).to.equal(payer.publicKey.toBase58());
    expect("valid" in account.status).to.equal(true);
    expect(account.expiresAt.toNumber()).to.equal(expiresAt);
  });

  it("revoking flips status to Revoked without touching other fields", async function () {
    this.timeout(30_000);
    await program.methods
      .revokeCredential()
      .accounts({
        issuer: payer.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(testWallet.publicKey),
      })
      .rpc();

    const account = await program.account.eligibilityCredential.fetch(credentialPda(testWallet.publicKey));
    expect("revoked" in account.status).to.equal(true);
    expect(account.wallet.toBase58()).to.equal(testWallet.publicKey.toBase58());
  });
});
