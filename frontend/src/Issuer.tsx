import { useEffect, useState } from "react";
import { s, C, tint } from "./style";
import { PROGRAMS, WALLETS, short, dstr } from "./constants";
import type { WalletKey } from "./constants";
import { api } from "./api";
import type { CredentialView, PyleState } from "./types";

function labelFor(wallet: string): string {
  const entry = (Object.entries(WALLETS) as [WalletKey, (typeof WALLETS)[WalletKey]][]).find(([, w]) => w.addr === wallet);
  return entry ? entry[1].name : "";
}

export function Issuer({ state, refreshAllCredentials }: { state: PyleState; refreshAllCredentials: () => void }) {
  const [rows, setRows] = useState<CredentialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.getCredentials());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (wallet: string) => {
    setRevoking(wallet);
    try {
      await api.revoke(wallet);
      await load();
      refreshAllCredentials();
    } finally {
      setRevoking(null);
    }
  };

  const now = Date.now() / 1000;
  const isExpired = (r: CredentialView) => r.status === "Valid" && (r.expiresAt ?? 0) <= now;
  const statusOf = (r: CredentialView) => (r.status === "Revoked" ? "REVOKED" : isExpired(r) ? "EXPIRED" : "VALID");
  const colorOf = (st: string) => (st === "VALID" ? [tint.lime, C.lime] : st === "EXPIRED" ? [tint.amber, C.amber] : [tint.red, C.red]);

  const issuerStats = [
    { label: "Valid", value: rows.filter((r) => statusOf(r) === "VALID").length, color: C.lime },
    { label: "Expired", value: rows.filter((r) => statusOf(r) === "EXPIRED").length, color: C.amber },
    { label: "Revoked", value: rows.filter((r) => statusOf(r) === "REVOKED").length, color: C.red },
    { label: "Attestations seen", value: state.mpcAttestations.length, color: C.ink },
  ];

  return (
    <main style={s("flex:1;max-width:1240px;width:100%;box-sizing:border-box;margin:0 auto;padding:28px 24px 48px;display:flex;flex-direction:column;gap:20px")}>
      <div style={s("display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px")}>
        <div style={s("display:flex;flex-direction:column;gap:6px")}>
          <span style={s("font:500 12px 'Geist Mono',monospace;color:#8d8f88")}>eligibility-credential · issuer 3iWQ…9Cne</span>
          <h1 style={s("margin:0;font-weight:500;font-size:clamp(26px,3vw,36px);letter-spacing:-0.03em")}>Issuer</h1>
        </div>
        <div style={s("display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid rgba(236,235,230,0.1);border-radius:9px")}>
          <span style={s("width:7px;height:7px;border-radius:50%;background:#d4f27a;animation:pyPulse 2s infinite")} />
          <span style={s("font-size:12.5px")}>Issuer bridge</span>
          <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#8d8f88")}>watching live</span>
        </div>
      </div>

      <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:rgba(236,235,230,0.08);border-radius:12px;overflow:hidden;border:1px solid rgba(236,235,230,0.08)")}>
        {issuerStats.map((st) => (
          <div key={st.label} style={s("background:#111311;padding:14px 16px;display:flex;flex-direction:column;gap:6px")}>
            <span style={s("font-size:11.5px;color:#8d8f88")}>{st.label}</span>
            <span style={{ ...s("font:500 20px 'Geist Mono',monospace"), color: st.color }}>{st.value}</span>
          </div>
        ))}
      </div>

      <div style={s("display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start")}>
        <div style={s("flex:1.6 1 560px;min-width:0;background:#111311;border:1px solid rgba(236,235,230,0.08);border-radius:12px;overflow:hidden")}>
          <div style={s("padding:12px 16px;border-bottom:1px solid rgba(236,235,230,0.08);display:flex;justify-content:space-between;align-items:center")}>
            <span style={s("font-weight:500;font-size:14px")}>Credentials</span>
            <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#8d8f88")}>policy US_ACCREDITED</span>
          </div>
          <div style={s("display:grid;grid-template-columns:minmax(100px,1fr) 84px 96px 96px 84px;gap:12px;padding:9px 16px;font:400 10.5px 'Geist Mono',monospace;color:#6f716b;border-bottom:1px solid rgba(236,235,230,0.05)")}>
            <span>WALLET</span>
            <span>STATUS</span>
            <span>ISSUED</span>
            <span>EXPIRES</span>
            <span></span>
          </div>
          {loading && <div style={s("padding:16px;font-size:12.5px;color:#6f716b")}>Loading…</div>}
          {!loading && rows.length === 0 && <div style={s("padding:16px;font-size:12.5px;color:#6f716b")}>No credentials issued yet.</div>}
          {rows.map((r) => {
            const st = statusOf(r);
            const [bg, fg] = colorOf(st);
            const canRevoke = st === "VALID";
            return (
              <div key={r.wallet} style={s("display:grid;grid-template-columns:minmax(100px,1fr) 84px 96px 96px 84px;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(236,235,230,0.05)")}>
                <span style={s("font:400 12px 'Geist Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {short(r.wallet)} <span style={s("color:#6f716b")}>{labelFor(r.wallet)}</span>
                </span>
                <span style={{ ...s("justify-self:start;font:500 10px 'Geist Mono',monospace;padding:3px 6px;border-radius:4px"), background: bg, color: fg }}>{st}</span>
                <span style={s("font:400 11.5px 'Geist Mono',monospace;color:#8d8f88")}>{r.issuedAt ? dstr(r.issuedAt) : "—"}</span>
                <span style={{ ...s("font:400 11.5px 'Geist Mono',monospace"), color: st === "EXPIRED" ? C.amber : C.muted }}>{r.expiresAt ? dstr(r.expiresAt) : "—"}</span>
                {canRevoke ? (
                  <button
                    onClick={() => void revoke(r.wallet)}
                    disabled={revoking === r.wallet}
                    style={s("justify-self:end;border:1px solid rgba(255,107,91,0.3);cursor:pointer;font-size:11.5px;padding:4px 9px;border-radius:6px;background:transparent;color:#ff6b5b")}
                  >
                    {revoking === r.wallet ? "…" : "Revoke"}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
        <div style={s("flex:1 1 340px;min-width:0;display:flex;flex-direction:column;gap:20px")}>
          <div style={s("background:#111311;border:1px solid rgba(236,235,230,0.08);border-radius:12px;overflow:hidden")}>
            <div style={s("padding:12px 16px;border-bottom:1px solid rgba(236,235,230,0.08);display:flex;flex-direction:column;gap:3px")}>
              <span style={s("font-weight:500;font-size:14px")}>MPC attestations</span>
              <span style={s("font-size:12px;color:#8d8f88")}>EligibilityComputedEvent from eligibility-mpc</span>
            </div>
            {state.mpcAttestations.length === 0 && <div style={s("padding:16px;font-size:12.5px;color:#6f716b")}>No checks run yet this session.</div>}
            {state.mpcAttestations.slice(0, 8).map((a) => (
              <div key={a.signature} style={s("display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(236,235,230,0.05)")}>
                <span style={s("flex:1;font:400 12px 'Geist Mono',monospace")}>
                  {short(a.wallet)} {labelFor(a.wallet)}
                </span>
                <span style={{ ...s("font:500 11.5px 'Geist Mono',monospace"), color: a.eligible ? C.lime : C.red }}>eligible = {String(a.eligible)}</span>
              </div>
            ))}
          </div>
          <div style={s("background:#111311;border:1px solid rgba(236,235,230,0.08);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;font:400 12px 'Geist Mono',monospace")}>
            <span style={s("font:500 14px Geist,sans-serif")}>Programs</span>
            {[
              ["eligibility-credential", short(PROGRAMS.eligibilityCredential)],
              ["transfer-hook", short(PROGRAMS.transferHook)],
              ["eligibility-mpc", short(PROGRAMS.eligibilityMpc)],
            ].map(([k, v]) => (
              <div key={k} style={s("display:flex;justify-content:space-between;gap:12px")}>
                <span style={s("color:#8d8f88")}>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
