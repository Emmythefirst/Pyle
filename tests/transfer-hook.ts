import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Real devnet enforcement, against the persistent demo mint
// (scripts/eligibility-test/setup-demo-mint.ts) -- not the live DBC demo
// pool, and not wallet A/B/C, so this never disturbs the demo's actual
// state. A fresh throwaway wallet per run means these three tests must run
// in order (no credential -> issued -> revoked), each depending on the
// previous one's on-chain effect.

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

describe("transfer-hook (real devnet)", () => {
  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const provider = new AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const credentialIdl = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../target/idl/eligibility_credential.json"), "utf-8"),
  );
  const credentialProgram = new Program(credentialIdl as Idl, provider) as never as {
    methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: () => Promise<string> } }>;
  };

  const demoMint = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../demo-mint.json"), "utf-8")) as {
    mint: string;
    decimals: number;
    treasury: string;
    treasuryAta: string;
  };
  const mint = new PublicKey(demoMint.mint);
  const treasuryAta = new PublicKey(demoMint.treasuryAta);

  const testWallet = Keypair.generate();
  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  );

  before(async function () {
    this.timeout(30_000);
    // createTransferCheckedWithTransferHookInstruction resolves the hook's
    // extra accounts via RPC reads *before* the transaction is built --
    // including reading the destination account's own data (our
    // Seed::AccountData-based credential PDA derivation). For a brand-new
    // wallet that account doesn't exist yet, so it must be created and
    // confirmed in its own prior transaction; creating it in the same
    // transaction as the transfer is too late for that resolution step.
    const destAta = getAssociatedTokenAddressSync(mint, testWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destAta, testWallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [payer]);
  });

  async function attemptTransfer(): Promise<{ ok: boolean; error?: string }> {
    const destAta = getAssociatedTokenAddressSync(mint, testWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      connection,
      treasuryAta,
      mint,
      destAta,
      payer.publicKey,
      BigInt(1 * 10 ** demoMint.decimals),
      demoMint.decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    const tx = new Transaction().add(transferIx);
    try {
      await sendAndConfirmTransaction(connection, tx, [payer]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  it("blocks a transfer to a wallet with no credential", async function () {
    this.timeout(30_000);
    const result = await attemptTransfer();
    expect(result.ok).to.equal(false);
    expect(result.error).to.match(/AccountNotInitialized|0xbc4/);
  });

  it("allows the transfer once a valid credential is issued", async function () {
    this.timeout(30_000);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await credentialProgram.methods
      .issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(expiresAt))
      .accounts({
        issuer: payer.publicKey,
        wallet: testWallet.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(testWallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const result = await attemptTransfer();
    expect(result.ok, result.error).to.equal(true);
  });

  it("blocks the transfer again once the credential is revoked", async function () {
    this.timeout(30_000);
    await credentialProgram.methods
      .revokeCredential()
      .accounts({
        issuer: payer.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(testWallet.publicKey),
      })
      .rpc();

    const result = await attemptTransfer();
    expect(result.ok).to.equal(false);
    expect(result.error).to.match(/CredentialRevoked/);
  });
});
