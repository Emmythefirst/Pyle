import "dotenv/config";
import { Connection } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

const connection = new Connection(RPC_URL, "confirmed");

async function main() {
  const version = await connection.getVersion();
  console.log(`Pyle backend connected to ${RPC_URL}`, version);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
