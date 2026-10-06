import { createServer } from "http";
import { WebSocketServer } from "ws";
import { onEvent, state } from "./state.js";
import { WS_PORT } from "./config.js";

/**
 * One HTTP server doing double duty: GET /state returns a snapshot (for a
 * dashboard's initial render), and it's upgraded to a WebSocket connection
 * for live updates after that. Simple on purpose -- this is a demo feed for
 * one dashboard, not a public API.
 */
export function startServer(): void {
  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/state") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(state));
      return;
    }
    res.writeHead(404);
    res.end();
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
    console.log(`Pyle backend listening on :${WS_PORT} (GET /state, WebSocket for live events)`);
  });
}
