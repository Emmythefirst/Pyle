import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { recordMpcAttestation } from "../state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eligibility-mpc lives in its own isolated Cargo/npm workspace (progress.md
// §12 -- a Rust dependency-version conflict with the rest of the project),
// so its IDL is built under arcium-mpc/target/idl, not this repo's root one.
const ELIGIBILITY_MPC_PROGRAM_ID = new PublicKey("4Fdcz9uK5SKnH5X5XAfwfH1bD1oefpz3LLLRbaN7zTbh");

export function watchMpcAttestations(connection: Connection): void {
  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../../arcium-mpc/target/idl/eligibility_mpc.json"),
      "utf-8",
    ),
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(anchor.web3.Keypair.generate()), {
    commitment: "confirmed",
  });
  const program = new Program(idl as Idl, provider);

  connection.onLogs(
    ELIGIBILITY_MPC_PROGRAM_ID,
    (logs) => {
      if (logs.err) return;
      for (const log of logs.logs) {
        if (!log.startsWith("Program data: ")) continue;
        try {
          const decoded = program.coder.events.decode(log.slice("Program data: ".length));
          if (decoded?.name !== "eligibilityComputedEvent") continue;
          const data = decoded.data as { wallet: PublicKey; eligible: boolean };
          recordMpcAttestation({
            type: "mpc_attestation",
            wallet: data.wallet.toBase58(),
            eligible: data.eligible,
            signature: logs.signature,
            timestamp: Date.now(),
          });
          console.log(
            `[mpc] eligible=${data.eligible} -- ${data.wallet.toBase58()} (${logs.signature})`,
          );
        } catch {
          // not our event -- keep scanning
        }
      }
    },
    "confirmed",
  );
  console.log(
    `Watching eligibility-mpc (${ELIGIBILITY_MPC_PROGRAM_ID.toBase58()}) for computed attestations...`,
  );
}
