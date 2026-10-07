import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ELIGIBILITY_CREDENTIAL_PROGRAM_ID, POLICY_US_ACCREDITED } from "./config.js";
import { DEMO_WALLETS, TREASURY_KEYPAIR, WalletKey, resolveWalletKey } from "./demoWallets.js";
import { errorMessage } from "./errorMessage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCredentialProgram(connection: Connection, signer: anchor.web3.Keypair): Program<Idl> {
  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../target/idl/eligibility_credential.json"),
      "utf-8",
    ),
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(signer), {
    commitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

function credentialPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("eligibility"), wallet.toBuffer(), POLICY_US_ACCREDITED],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  )[0];
}

export interface CredentialView {
  wallet: string;
  exists: boolean;
  status?: "Valid" | "Revoked" | "Expired";
  issuedAt?: number;
  expiresAt?: number;
}

function resolvePubkey(walletOrKey: string): PublicKey {
  const key = resolveWalletKey(walletOrKey);
  return key ? DEMO_WALLETS[key].publicKey : new PublicKey(walletOrKey);
}

export async function getCredential(connection: Connection, walletOrKey: string): Promise<CredentialView> {
  const walletPubkey = resolvePubkey(walletOrKey);
  const program = loadCredentialProgram(connection, TREASURY_KEYPAIR);
  const pda = credentialPda(walletPubkey);
  try {
    const account = await (
      program.account as never as {
        eligibilityCredential: {
          fetch: (addr: PublicKey) => Promise<{
            status: Record<string, unknown>;
            issuedAt: BN;
            expiresAt: BN;
          }>;
        };
      }
    ).eligibilityCredential.fetch(pda);
    const status = Object.keys(account.status)[0];
    return {
      wallet: walletPubkey.toBase58(),
      exists: true,
      status: (status.charAt(0).toUpperCase() + status.slice(1)) as CredentialView["status"],
      issuedAt: account.issuedAt.toNumber(),
      expiresAt: account.expiresAt.toNumber(),
    };
  } catch {
    return { wallet: walletPubkey.toBase58(), exists: false };
  }
}

export async function listCredentials(connection: Connection): Promise<CredentialView[]> {
  const program = loadCredentialProgram(connection, TREASURY_KEYPAIR);
  const all = await (
    program.account as never as {
      eligibilityCredential: {
        all: () => Promise<
          { publicKey: PublicKey; account: { wallet: PublicKey; status: Record<string, unknown>; issuedAt: BN; expiresAt: BN } }[]
        >;
      };
    }
  ).eligibilityCredential.all();
  return all.map(({ account }) => {
    const status = Object.keys(account.status)[0];
    return {
      wallet: account.wallet.toBase58(),
      exists: true,
      status: (status.charAt(0).toUpperCase() + status.slice(1)) as CredentialView["status"],
      issuedAt: account.issuedAt.toNumber(),
      expiresAt: account.expiresAt.toNumber(),
    };
  });
}

export async function revokeCredential(
  connection: Connection,
  walletOrKey: string,
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const walletPubkey = resolvePubkey(walletOrKey);
  const program = loadCredentialProgram(connection, TREASURY_KEYPAIR);
  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  );
  try {
    const signature = await (
      program as never as {
        methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: () => Promise<string> } }>;
      }
    )
      .methods.revokeCredential()
      .accounts({
        issuer: TREASURY_KEYPAIR.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(walletPubkey),
      })
      .rpc();
    return { ok: true, signature };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// So a demo can re-issue a fresh credential without going through the MPC
// flow again (e.g. resetting wallet C back to a non-expired state) --
// reuses the exact instruction scripts/eligibility-test and verify-cli.ts do.
export async function issueCredential(
  connection: Connection,
  walletKey: WalletKey,
  expiresInSecs: number,
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const wallet = DEMO_WALLETS[walletKey];
  const program = loadCredentialProgram(connection, TREASURY_KEYPAIR);
  const [issuerConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer-config")],
    ELIGIBILITY_CREDENTIAL_PROGRAM_ID,
  );
  const nowSecs = Math.floor(Date.now() / 1000);
  try {
    const signature = await (
      program as never as {
        methods: Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { rpc: () => Promise<string> } }>;
      }
    )
      .methods.issueCredential(Array.from(POLICY_US_ACCREDITED), new BN(nowSecs + expiresInSecs))
      .accounts({
        issuer: TREASURY_KEYPAIR.publicKey,
        wallet: wallet.publicKey,
        issuerConfig: issuerConfigPda,
        credential: credentialPda(wallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { ok: true, signature };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
