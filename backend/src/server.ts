import { createServer, IncomingMessage, ServerResponse } from "http";
import { Connection } from "@solana/web3.js";
import { WebSocketServer } from "ws";
import { onEvent, state } from "./state.js";
import { WS_PORT } from "./config.js";
import { buyAsWallet } from "./buy.js";
import { getCredential, listCredentials, revokeCredential } from "./credentialApi.js";
import { runEligibilityCheck } from "./mpcApi.js";
import { resolveWalletKey } from "./demoWallets.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

/**
 * One HTTP server doing double duty: a handful of routes for the terminal's
 * real actions (buy, verify, credential reads, revoke) plus GET /state for a
 * dashboard's initial render, then upgraded to a WebSocket connection for
 * live updates after that. Simple on purpose -- this is a demo backend for
 * one dashboard, not a public API.
 */
export function startServer(connection: Connection): void {
  const httpServer = createServer((req, res) => {
    void handleRequest(connection, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "snapshot", state }));
  });

  onEvent((event) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  });

  httpServer.listen(WS_PORT, () => {
    console.log(`Pyle backend listening on :${WS_PORT} (HTTP routes + WebSocket for live events)`);
  });
}

async function handleRequest(
  connection: Connection,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/state") {
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "GET" && url.pathname === "/credentials") {
      sendJson(res, 200, await listCredentials(connection));
      return;
    }

    const credentialMatch = url.pathname.match(/^\/credential\/(.+)$/);
    if (req.method === "GET" && credentialMatch) {
      sendJson(res, 200, await getCredential(connection, credentialMatch[1]));
      return;
    }

    if (req.method === "POST" && url.pathname === "/buy") {
      const body = await readJsonBody(req);
      const walletKey = resolveWalletKey(String(body.wallet ?? ""));
      if (!walletKey) return sendJson(res, 400, { error: "wallet must be A, B, or C" });
      const amount = Number(body.amount ?? 0);
      sendJson(res, 200, await buyAsWallet(connection, walletKey, amount));
      return;
    }

    if (req.method === "POST" && url.pathname === "/verify") {
      const body = await readJsonBody(req);
      const walletKey = resolveWalletKey(String(body.wallet ?? ""));
      if (!walletKey) return sendJson(res, 400, { error: "wallet must be A, B, or C" });
      const income = Number(body.income ?? 0);
      const netWorth = Number(body.netWorth ?? 0);
      const result = await runEligibilityCheck(walletKey, income, netWorth);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/revoke") {
      const body = await readJsonBody(req);
      const wallet = String(body.wallet ?? "");
      sendJson(res, 200, await revokeCredential(connection, wallet));
      return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end();
  } catch (err) {
    console.error(`Request failed: ${req.method} ${url.pathname}`, err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
