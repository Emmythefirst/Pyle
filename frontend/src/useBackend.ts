import { useEffect, useRef, useState } from "react";
import { BACKEND_WS } from "./constants";
import type { PyleEvent, PyleState } from "./types";

const EMPTY_STATE: PyleState = {
  blockedTransfers: [],
  successfulBuys: [],
  credentialActivity: [],
  poolState: { type: "pool_state", configured: false, quoteReserve: null, migrationQuoteThreshold: null, percentComplete: null, migrated: false, dammV2Pool: null },
  credentialedWalletCount: 0,
  mpcAttestations: [],
};

const MAX_LEN = 200;

function applyEvent(state: PyleState, event: PyleEvent): PyleState {
  switch (event.type) {
    case "blocked_transfer":
      return { ...state, blockedTransfers: [event, ...state.blockedTransfers].slice(0, MAX_LEN) };
    case "successful_buy":
      return { ...state, successfulBuys: [event, ...state.successfulBuys].slice(0, MAX_LEN) };
    case "credential_activity":
      return { ...state, credentialActivity: [event, ...state.credentialActivity].slice(0, MAX_LEN) };
    case "pool_state":
      return { ...state, poolState: event };
    case "credentialed_wallet_count":
      return { ...state, credentialedWalletCount: event.count };
    case "mpc_attestation":
      return { ...state, mpcAttestations: [event, ...state.mpcAttestations].slice(0, MAX_LEN) };
    default:
      return state;
  }
}

/**
 * Live connection to the backend's WebSocket feed. The first message after
 * connecting is always a full snapshot (server.ts), everything after that is
 * a single PyleEvent to fold in -- reconnects with backoff if the backend
 * restarts or the dev server bounces.
 */
export function useBackend(): { state: PyleState; connected: boolean } {
  const [state, setState] = useState<PyleState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(BACKEND_WS);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot") {
          setState(msg.state as PyleState);
        } else {
          setState(applyEvent(stateRef.current, msg as PyleEvent));
        }
      };
    }
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return { state, connected };
}
