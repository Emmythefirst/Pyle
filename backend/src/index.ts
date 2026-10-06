import "dotenv/config";
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./config.js";
import { startServer } from "./server.js";
import { watchTransferHook } from "./watchers/transferHookWatcher.js";
import { watchCredentialActivity, startCredentialCountPolling } from "./watchers/credentialWatcher.js";
import { startPoolPolling } from "./watchers/poolWatcher.js";

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const version = await connection.getVersion();
  console.log(`Pyle backend connected to ${RPC_URL}`, version);

  watchTransferHook(connection);
  watchCredentialActivity(connection);
  startCredentialCountPolling(connection);
  startPoolPolling(connection);
  startServer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
