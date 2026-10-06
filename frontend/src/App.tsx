import { useCallback, useEffect, useState } from "react";
import { s, C } from "./style";
import { WALLETS, short } from "./constants";
import type { WalletKey } from "./constants";
import { api } from "./api";
import { useBackend } from "./useBackend";
import type { CredentialView } from "./types";
import { Landing } from "./Landing";
import { Terminal } from "./Terminal";
import { Issuer } from "./Issuer";

export type View = "landing" | "terminal" | "issuer";
export type CredentialsMap = Partial<Record<WalletKey, CredentialView>>;

const statusDot = (c?: CredentialView): string => {
  if (!c || !c.exists) return C.red;
  if (c.status === "Valid" && (c.expiresAt ?? 0) > Date.now() / 1000) return C.lime;
  return C.amber;
};

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [activeWallet, setActiveWallet] = useState<WalletKey>("A");
  const [credentials, setCredentials] = useState<CredentialsMap>({});
  const { state, connected } = useBackend();

  const refreshCredential = useCallback(async (wallet: WalletKey) => {
    const cred = await api.getCredential(wallet);
    setCredentials((prev) => ({ ...prev, [wallet]: cred }));
  }, []);

  const refreshAllCredentials = useCallback(() => {
    for (const key of Object.keys(WALLETS) as WalletKey[]) void refreshCredential(key);
  }, [refreshCredential]);

  useEffect(() => {
    refreshAllCredentials();
  }, [refreshAllCredentials]);

  const cred = credentials[activeWallet];
  const notLanding = view !== "landing";

  const navItems: { key: View; label: string }[] = [
    { key: "landing", label: "Overview" },
    { key: "terminal", label: "Terminal" },
    { key: "issuer", label: "Issuer" },
  ];

  return (
    <div style={s("min-height:100vh;display:flex;flex-direction:column;background:#0b0c0b")}>
      <header
        style={s(
          "position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:12px 22px;padding:14px 24px;border-bottom:1px solid rgba(236,235,230,0.08);background:rgba(11,12,11,0.88);backdrop-filter:blur(12px)",
        )}
      >
        <button
          onClick={() => setView("landing")}
          style={s("display:flex;align-items:center;gap:9px;border:0;background:transparent;color:#ecebe6;cursor:pointer;padding:0")}
        >
          <span
            style={s(
              "width:20px;height:20px;box-sizing:border-box;border-top:2.5px solid #ecebe6;display:flex;justify-content:space-between;padding:0 3px",
            )}
          >
            <span style={s("width:3px;background:#ecebe6")} />
            <span style={s("width:3px;background:#ecebe6")} />
          </span>
          <span style={s("font-weight:600;font-size:17px;letter-spacing:-0.02em")}>Pyle</span>
        </button>
        <nav style={s("display:flex;gap:18px")}>
          {navItems.map((n) => (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              style={s(`border:0;background:transparent;cursor:pointer;padding:4px 0;font-size:13px;color:${view === n.key ? C.ink : C.muted}`)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div style={s("flex:1")} />
        <span style={s("font:500 11.5px 'Geist Mono',monospace;color:#8d8f88;display:flex;align-items:center;gap:6px")}>
          <span style={s(`width:6px;height:6px;border-radius:50%;background:${connected ? C.lime : C.dim};animation:${connected ? "pyPulse 2s infinite" : "none"}`)} />
          devnet{connected ? "" : " · connecting…"}
        </span>
        {notLanding && (
          <span
            title={WALLETS[activeWallet].addr}
            style={s(
              "font:500 12px 'Geist Mono',monospace;padding:7px 11px;border:1px solid rgba(236,235,230,0.12);border-radius:8px;display:flex;align-items:center;gap:8px",
            )}
          >
            <span style={s(`width:7px;height:7px;border-radius:50%;background:${statusDot(cred)}`)} />
            {short(WALLETS[activeWallet].addr)}
          </span>
        )}
        {view === "landing" && (
          <button
            onClick={() => setView("terminal")}
            style={s("border:0;cursor:pointer;font-weight:500;font-size:13px;padding:8px 14px;border-radius:8px;background:#ecebe6;color:#0b0c0b")}
          >
            Open terminal
          </button>
        )}
      </header>

      {view === "landing" && <Landing goTerminal={() => setView("terminal")} goVerify={() => setView("terminal")} state={state} credentials={credentials} />}

      {view === "terminal" && (
        <Terminal
          state={state}
          activeWallet={activeWallet}
          setActiveWallet={setActiveWallet}
          credentials={credentials}
          refreshCredential={refreshCredential}
        />
      )}

      {view === "issuer" && <Issuer refreshAllCredentials={refreshAllCredentials} state={state} />}
    </div>
  );
}
