import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

// One-time setup for a PERSISTENT demo mint the frontend's real "Buy" action
// transfers against directly (plain transferChecked, no DBC pool involved --
// see progress.md's frontend-build notes for why: the transfer hook gates on
// destination_token_account.owner regardless of what moved the tokens, so a
// direct Token-2022 transfer exercises the exact same real credential check
// a DBC swap would, without needing a persistent bonding curve deployed).
// Run once; writes demo-mint.json for the backend to read on every start.

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "F9p71yDgPkb3u6FM8jVaGWqQgDY2z6hGmHLof8FANr4z",
);
const DECIMALS = 6;
const SUPPLY_TOKENS = 1_000_000_000;

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(name: string) {
  const idlPath = path.resolve(import.meta.dirname, "../../target/idl", `${name}.json`);
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  console.log("treasury/payer:", payer.publicKey.toBase58());

  const mint = Keypair.generate();
  console.log("mint:", mint.publicKey.toBase58());

  const mintLen = getMintLen([ExtensionType.TransferHook]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      mint.publicKey,
      payer.publicKey,
      TRANSFER_HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      DECIMALS,
      payer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createMintTx, [payer, mint]);
  console.log("[ok] mint created with transfer-hook extension");

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  const hookIdl = loadIdl("transfer_hook");
  const hookProgram = new anchor.Program(hookIdl as anchor.Idl, provider);
  const [extraAccountMetasListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID,
  );
  await hookProgram.methods
    .initializeExtraAccountMetasList()
    .accounts({
      payer: payer.publicKey,
      tokenMint: mint.publicKey,
      extraAccountMetasList: extraAccountMetasListPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("[ok] initialize_extra_account_metas_list");

  const walletA = loadKeypair(path.resolve(import.meta.dirname, "wallet-a-keypair.json"));
  const walletB = loadKeypair(path.resolve(import.meta.dirname, "wallet-b-keypair.json"));
  const walletC = loadKeypair(path.resolve(import.meta.dirname, "wallet-c-keypair.json"));

  const treasuryAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const ataSetupTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      treasuryAta,
      payer.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    ...[walletA, walletB, walletC].map((w) =>
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        getAssociatedTokenAddressSync(mint.publicKey, w.publicKey, false, TOKEN_2022_PROGRAM_ID),
        w.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
    createMintToInstruction(
      mint.publicKey,
      treasuryAta,
      payer.publicKey,
      BigInt(SUPPLY_TOKENS) * BigInt(10 ** DECIMALS),
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, ataSetupTx, [payer]);
  console.log("[ok] treasury + wallet A/B/C ATAs created, supply minted to treasury");

  const out = {
    mint: mint.publicKey.toBase58(),
    decimals: DECIMALS,
    treasury: payer.publicKey.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
  };
  const outPath = path.resolve(import.meta.dirname, "../../demo-mint.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("saved", outPath, out);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
